#!/bin/sh
set -e

echo "==> [1/5] Ensuring directories exist..."
mkdir -p /app/instance/storage /app/instance/uploads /etc/nginx/conf.d

echo "==> [2/5] Starting embedded Redis server..."
redis-server --daemonize yes --protected-mode no --port 6379 --maxmemory 64mb --maxmemory-policy allkeys-lru

until redis-cli ping 2>/dev/null | grep -q PONG; do
  echo "Waiting for Redis to become available..."
  sleep 0.5
done
echo "Redis is ready."

# Detect custom endpoint / configuration and ensure minimum 2 workers
GUNICORN_WORKERS="${GUNICORN_WORKERS:-1}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-2}"

IS_CUSTOM_ENDPOINT=0
if [ -n "$LLM_BASE_URL" ] && [ "$LLM_BASE_URL" != "http://localhost:8000/v1" ]; then
  IS_CUSTOM_ENDPOINT=1
fi
if [ "$LLM_BACKEND" = "real" ] || [ "$LLM_BACKEND" = "custom" ] || [ -n "$CUSTOM_ENDPOINT" ]; then
  IS_CUSTOM_ENDPOINT=1
fi
if [ -n "$LLM_API_KEY" ]; then
  IS_CUSTOM_ENDPOINT=1
fi

if [ "$IS_CUSTOM_ENDPOINT" -eq 1 ]; then
  echo "==> Custom endpoint detected. Ensuring minimum worker concurrency of 2..."
  if [ "$GUNICORN_WORKERS" -lt 2 ]; then
    GUNICORN_WORKERS=2
  fi
  if [ "$CELERY_CONCURRENCY" -lt 2 ]; then
    CELERY_CONCURRENCY=2
  fi
fi

echo "==> [3/5] Ensuring database schema, views, and canonical accounts are initialized..."
cd /app
python -c "from app import create_app; from app.cli import ensure_database_ready; app = create_app(); ctx = app.app_context(); ctx.push(); ensure_database_ready()" || true

echo "==> [4/5] Starting Gunicorn Flask API on 127.0.0.1:5000 (workers=${GUNICORN_WORKERS})..."
gunicorn run:app --bind 127.0.0.1:5000 --workers "${GUNICORN_WORKERS}" --worker-class gthread --threads 4 --timeout 600 &

echo "==> [5/5] Starting Celery background worker (concurrency=${CELERY_CONCURRENCY})..."
celery -A app.workers.celery_app worker -l info --pool=threads --concurrency="${CELERY_CONCURRENCY}" &

# Fast poll until Flask API is live
until curl -s http://127.0.0.1:5000/api/health >/dev/null 2>&1; do
  sleep 0.2
done
echo "Flask API is live."


echo "==> Configuring Nginx on PORT ${PORT:-10000} and starting web server..."
export PORT="${PORT:-10000}"
export API_URL="http://127.0.0.1:5000"

envsubst '${PORT} ${API_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Keep container running with Nginx in the foreground
exec nginx -g 'daemon off;'
