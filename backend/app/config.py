import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Automatically load environment variables from backend/.env or root .env
if (BASE_DIR / ".env").exists():
    load_dotenv(BASE_DIR / ".env")
elif (BASE_DIR.parent / ".env").exists():
    load_dotenv(BASE_DIR.parent / ".env")


def _bool(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


class Config:
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "dev-secret")

    _raw_db = os.environ.get("DATABASE_URL", "")
    if not _raw_db:
        _db_p = BASE_DIR / "instance" / "finsight.db"
        _db_p.parent.mkdir(parents=True, exist_ok=True)
        SQLALCHEMY_DATABASE_URI = f"sqlite:///{_db_p.as_posix()}"
    elif _raw_db.startswith("sqlite:///") and not _raw_db.startswith("sqlite:////"):
        _rel = _raw_db[len("sqlite:///"):]
        _p = Path(_rel)
        if not _p.is_absolute():
            if (BASE_DIR.parent / "instance" / "finsight.db").exists():
                _p = BASE_DIR.parent / "instance" / "finsight.db"
            elif (BASE_DIR / "instance" / "finsight.db").exists():
                _p = BASE_DIR / "instance" / "finsight.db"
            else:
                _p = BASE_DIR / _p
            _p.parent.mkdir(parents=True, exist_ok=True)
            SQLALCHEMY_DATABASE_URI = f"sqlite:///{_p.as_posix()}"
        else:
            SQLALCHEMY_DATABASE_URI = _raw_db
    else:
        SQLALCHEMY_DATABASE_URI = _raw_db

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        # SQLite + Celery threads: avoid pooled connections outliving a worker thread.
        "pool_pre_ping": True,
        "connect_args": {"timeout": 60},
    }

    # Always absolute.
    STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "") or BASE_DIR / "instance" / "storage")
    if not STORAGE_ROOT.is_absolute():
        if (BASE_DIR.parent / STORAGE_ROOT).exists():
            STORAGE_ROOT = BASE_DIR.parent / STORAGE_ROOT
        else:
            STORAGE_ROOT = BASE_DIR / STORAGE_ROOT
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

    CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
    CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

    # "auto" (default): picks whichever provider has an API key configured, checked in
    # this order -- openai, gemini, custom (LLM_API_KEY) -- falling back to "fake" if none
    # do. Set explicitly ("fake" | "real" | "openai" | "gemini") to pin one regardless of
    # what keys are present. See app/llm_gateway/__init__.py's resolve_backend().
    LLM_BACKEND = os.environ.get("LLM_BACKEND", "auto")
    LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8000/v1")
    LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
    LLM_MODEL_NAME = os.environ.get("LLM_MODEL_NAME", "custom-model")
    LLM_EMBEDDINGS_ENABLED = _bool("LLM_EMBEDDINGS_ENABLED", "false")

    # NVIDIA NIM models
    NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")
    NVIDIA_BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
    NVIDIA_MODEL_NAME = os.environ.get("NVIDIA_MODEL_NAME", "nvidia/nemotron-3.5-super-vl-120b-a12b")
    NVIDIA_REASONING_MODEL_NAME = os.environ.get("NVIDIA_REASONING_MODEL_NAME", "nvidia/nemotron-3.5-super-vl-120b-a12b")

    # Master switch: true = up to LLM_MAX_CONCURRENT_REQUESTS calls may be in flight at once
    # across agents/threads. Enabled by default for hosted models (NVIDIA NIM/Custom).
    LLM_PARALLEL_CALLS = _bool("LLM_PARALLEL_CALLS", "true")
    LLM_MAX_CONCURRENT_REQUESTS = int(os.environ.get("LLM_MAX_CONCURRENT_REQUESTS", "5"))
    LLM_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", "8192"))
    LLM_TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.2"))
    LLM_PERSONA_PRESET = os.environ.get("LLM_PERSONA_PRESET", "virtual_cfo")
    LLM_CUSTOM_SYSTEM_PROMPT = os.environ.get("LLM_CUSTOM_SYSTEM_PROMPT", "")
    LLM_HISTORY_TURNS = int(os.environ.get("LLM_HISTORY_TURNS", "6"))
    LLM_FALLBACK_CASCADE = _bool("LLM_FALLBACK_CASCADE", "true")
    LLM_SHOW_TELEMETRY = _bool("LLM_SHOW_TELEMETRY", "true")
    LLM_TIMEOUT_S = float(os.environ.get("LLM_TIMEOUT_S", "90.0"))
    LLM_CONNECT_TIMEOUT_S = float(os.environ.get("LLM_CONNECT_TIMEOUT_S", "10.0"))
    LLM_CIRCUIT_BREAKER_S = float(os.environ.get("LLM_CIRCUIT_BREAKER_S", "20.0"))

    WEB_SEARCH_ENABLED = _bool("WEB_SEARCH_ENABLED", "true")
    WEB_SEARCH_NUM_RESULTS = int(os.environ.get("WEB_SEARCH_NUM_RESULTS", "3"))
    WEB_SEARCH_LINES_PER_RESULT = int(os.environ.get("WEB_SEARCH_LINES_PER_RESULT", "6"))
    WEB_SEARCH_TIMEOUT_S = int(os.environ.get("WEB_SEARCH_TIMEOUT_S", "10"))

    # Tavily MCP Web Intelligence & Value Validation
    TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "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")
    TAVILY_MCP_URL = os.environ.get("TAVILY_MCP_URL", f"https://mcp.tavily.com/mcp/?tavilyApiKey={os.environ.get('TAVILY_API_KEY', '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')}")

    OCR_ENABLED = _bool("OCR_ENABLED", "true")

    MAX_CONTENT_LENGTH = 200 * 1024 * 1024  # 200MB per upload request
    MAX_REPLANS = 2
    MAX_REPORT_REVISIONS = 2
    REVIEW_CONFIDENCE_THRESHOLD = 0.85
    # If true, low-confidence row mappings flag gaps but allow automated pipeline progress
    AUTO_APPROVE_LOW_CONFIDENCE = _bool("AUTO_APPROVE_LOW_CONFIDENCE", "true")
    # A reconciliation check failing by less than this (relative to the expected value) logs
    # a gap and lets the pipeline continue instead of blocking at AWAITING_REVIEW -- e.g. a
    # subset chart-of-accounts missing a granular Schedule III caption (minority interest,
    # share of associates' profit, ...) will legitimately leave a bounded gap in a formula
    # like "recomputed PAT = stated PAT" that isn't a data error. A NO_FACTS check (empty
    # dataset) always blocks regardless of this setting -- there's no "small" version of that.
    RECONCILIATION_MATERIALITY_PCT = float(os.environ.get("RECONCILIATION_MATERIALITY_PCT", "0.15"))

