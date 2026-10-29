from __future__ import annotations

import os
from pathlib import Path
from flask import Blueprint, current_app, jsonify, request

from app.llm_gateway import resolve_backend, reset_llm_gateway, is_configured_key, _PROVIDER_CONFIG_KEYS

bp = Blueprint("llm_config", __name__)


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "********"
    return f"{key[:4]}...{key[-4:]}"


def _update_env_file(updates: dict[str, str]) -> None:
    if current_app.config.get("TESTING"):
        return
    parent = Path(current_app.root_path).parent
    targets = [parent / ".env", parent / ".env.docker"]
    found = False
    for env_path in targets:
        if not env_path.exists():
            continue
        found = True
        try:
            content = env_path.read_text(encoding="utf-8")
            lines = content.splitlines()
            new_lines = []
            applied_keys = set()
            for line in lines:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key = stripped.split("=", 1)[0].strip()
                    if key in updates:
                        new_lines.append(f"{key}={updates[key]}")
                        applied_keys.add(key)
                        continue
                new_lines.append(line)
            for k, v in updates.items():
                if k not in applied_keys:
                    new_lines.append(f"{k}={v}")
            env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        except Exception as exc:
            current_app.logger.warning(f"Could not write to {env_path.name}: {exc}")
    if not found:
        target_env = parent / ".env"
        try:
            new_lines = [f"{k}={v}" for k, v in updates.items()]
            target_env.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        except Exception as exc:
            current_app.logger.warning(f"Could not create {target_env.name}: {exc}")


@bp.get("/status")
def get_status():
    backend = resolve_backend(current_app.config)
    config_keys = _PROVIDER_CONFIG_KEYS.get(backend)

    active_model = current_app.config.get(config_keys[2], "") if config_keys else "fake"
    reasoning_model = current_app.config.get(config_keys[3], "") if config_keys and config_keys[3] else None

    return jsonify({
        "status": "ok",
        "resolved_backend": backend,
        "configured_backend": current_app.config.get("LLM_BACKEND", "auto"),
        "active_model": active_model,
        "reasoning_model": reasoning_model,
        "parallel_calls": current_app.config.get("LLM_PARALLEL_CALLS", True),
        "max_concurrent_requests": current_app.config.get("LLM_MAX_CONCURRENT_REQUESTS", 5),
        "keys_configured": {
            "nvidia": is_configured_key(current_app.config.get("NVIDIA_API_KEY")),
            "custom": is_configured_key(current_app.config.get("LLM_API_KEY")),
        },
        "masked_keys": {
            "nvidia": _mask_key(current_app.config.get("NVIDIA_API_KEY", "")),
            "custom": _mask_key(current_app.config.get("LLM_API_KEY", "")),
        },
        "nvidia_base_url": current_app.config.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
        "custom_base_url": current_app.config.get("LLM_BASE_URL", "http://host.docker.internal:8000/v1"),
        "temperature": float(current_app.config.get("LLM_TEMPERATURE", 0.2)),
        "max_tokens": int(current_app.config.get("LLM_MAX_TOKENS", 8192)),
        "persona_preset": current_app.config.get("LLM_PERSONA_PRESET", "virtual_cfo"),
        "custom_system_prompt": current_app.config.get("LLM_CUSTOM_SYSTEM_PROMPT", ""),
        "history_turns": int(current_app.config.get("LLM_HISTORY_TURNS", 6)),
        "fallback_cascade": current_app.config.get("LLM_FALLBACK_CASCADE", True),
        "show_telemetry": current_app.config.get("LLM_SHOW_TELEMETRY", True),
        "timeout_s": float(current_app.config.get("LLM_TIMEOUT_S", 90.0)),
        "models": {
            "nvidia_model": current_app.config.get("NVIDIA_MODEL_NAME", "nvidia/nemotron-3.5-super-vl-120b-a12b"),
            "nvidia_base_url": current_app.config.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
            "custom_model": current_app.config.get("LLM_MODEL_NAME", "custom-model"),
            "custom_base_url": current_app.config.get("LLM_BASE_URL", "http://host.docker.internal:8000/v1"),
        },
        "available_backends": list(_PROVIDER_CONFIG_KEYS.keys()) + ["auto", "fake"],
    })


@bp.post("/config")
def update_config():
    data = request.get_json(silent=True) or {}
    env_updates: dict[str, str] = {}

    if "nvidia_api_key" in data:
        key = str(data["nvidia_api_key"]).strip()
        current_app.config["NVIDIA_API_KEY"] = key
        os.environ["NVIDIA_API_KEY"] = key
        env_updates["NVIDIA_API_KEY"] = key

    if "nvidia_base_url" in data:
        url = str(data["nvidia_base_url"]).strip()
        if url:
            current_app.config["NVIDIA_BASE_URL"] = url
            os.environ["NVIDIA_BASE_URL"] = url
            env_updates["NVIDIA_BASE_URL"] = url

    if "custom_api_key" in data or "llm_api_key" in data:
        key = str(data.get("custom_api_key") if "custom_api_key" in data else data.get("llm_api_key", "")).strip()
        current_app.config["LLM_API_KEY"] = key
        os.environ["LLM_API_KEY"] = key
        env_updates["LLM_API_KEY"] = key

    if "custom_base_url" in data or "llm_base_url" in data:
        url = str(data.get("custom_base_url") if "custom_base_url" in data else data.get("llm_base_url", "")).strip()
        if url:
            current_app.config["LLM_BASE_URL"] = url
            os.environ["LLM_BASE_URL"] = url
            env_updates["LLM_BASE_URL"] = url

    if "backend" in data:
        backend = str(data["backend"]).strip()
        current_app.config["LLM_BACKEND"] = backend
        os.environ["LLM_BACKEND"] = backend
        env_updates["LLM_BACKEND"] = backend

    if "parallel_calls" in data:
        parallel = bool(data["parallel_calls"])
        current_app.config["LLM_PARALLEL_CALLS"] = parallel
        os.environ["LLM_PARALLEL_CALLS"] = "true" if parallel else "false"
        env_updates["LLM_PARALLEL_CALLS"] = "true" if parallel else "false"

    if "max_concurrent_requests" in data:
        try:
            val = int(data["max_concurrent_requests"])
            val = max(1, min(val, 32))
            current_app.config["LLM_MAX_CONCURRENT_REQUESTS"] = val
            os.environ["LLM_MAX_CONCURRENT_REQUESTS"] = str(val)
            env_updates["LLM_MAX_CONCURRENT_REQUESTS"] = str(val)
        except (ValueError, TypeError):
            pass

    if "temperature" in data:
        try:
            temp = float(data["temperature"])
            temp = max(0.0, min(temp, 1.0))
            current_app.config["LLM_TEMPERATURE"] = temp
            os.environ["LLM_TEMPERATURE"] = str(temp)
            env_updates["LLM_TEMPERATURE"] = str(temp)
        except (ValueError, TypeError):
            pass

    if "max_tokens" in data:
        try:
            mt = int(data["max_tokens"])
            mt = max(512, min(mt, 32768))
            current_app.config["LLM_MAX_TOKENS"] = mt
            os.environ["LLM_MAX_TOKENS"] = str(mt)
            env_updates["LLM_MAX_TOKENS"] = str(mt)
        except (ValueError, TypeError):
            pass

    if "persona_preset" in data:
        preset = str(data["persona_preset"]).strip()
        current_app.config["LLM_PERSONA_PRESET"] = preset
        os.environ["LLM_PERSONA_PRESET"] = preset
        env_updates["LLM_PERSONA_PRESET"] = preset

    if "custom_system_prompt" in data:
        sp = str(data["custom_system_prompt"]).strip()
        current_app.config["LLM_CUSTOM_SYSTEM_PROMPT"] = sp
        os.environ["LLM_CUSTOM_SYSTEM_PROMPT"] = sp
        env_updates["LLM_CUSTOM_SYSTEM_PROMPT"] = sp

    if "history_turns" in data:
        try:
            ht = int(data["history_turns"])
            ht = max(1, min(ht, 30))
            current_app.config["LLM_HISTORY_TURNS"] = ht
            os.environ["LLM_HISTORY_TURNS"] = str(ht)
            env_updates["LLM_HISTORY_TURNS"] = str(ht)
        except (ValueError, TypeError):
            pass

    if "fallback_cascade" in data:
        fc = bool(data["fallback_cascade"])
        current_app.config["LLM_FALLBACK_CASCADE"] = fc
        os.environ["LLM_FALLBACK_CASCADE"] = "true" if fc else "false"
        env_updates["LLM_FALLBACK_CASCADE"] = "true" if fc else "false"

    if "show_telemetry" in data:
        st = bool(data["show_telemetry"])
        current_app.config["LLM_SHOW_TELEMETRY"] = st
        os.environ["LLM_SHOW_TELEMETRY"] = "true" if st else "false"
        env_updates["LLM_SHOW_TELEMETRY"] = "true" if st else "false"

    if "timeout_s" in data:
        try:
            to = float(data["timeout_s"])
            to = max(5.0, min(to, 300.0))
            current_app.config["LLM_TIMEOUT_S"] = to
            os.environ["LLM_TIMEOUT_S"] = str(to)
            env_updates["LLM_TIMEOUT_S"] = str(to)
        except (ValueError, TypeError):
            pass

    if "nvidia_model" in data:
        m = str(data["nvidia_model"]).strip()
        if m:
            current_app.config["NVIDIA_MODEL_NAME"] = m
            os.environ["NVIDIA_MODEL_NAME"] = m
            env_updates["NVIDIA_MODEL_NAME"] = m

    if "custom_model" in data:
        m = str(data["custom_model"]).strip()
        if m:
            current_app.config["LLM_MODEL_NAME"] = m
            os.environ["LLM_MODEL_NAME"] = m
            env_updates["LLM_MODEL_NAME"] = m

    if env_updates:
        _update_env_file(env_updates)

    reset_llm_gateway()
    return get_status()


@bp.post("/test")
def test_model():
    """Live connectivity and completion test for the currently configured LLM."""
    import time
    from app.llm_gateway import get_llm_gateway, resolve_backend

    data = request.get_json(silent=True) or {}
    test_prompt = data.get("prompt") or "Hello, please confirm you are active by responding with: 'FinSight LLM connection verified and operational.'"

    started = time.monotonic()
    backend = resolve_backend(current_app.config)

    try:
        gateway = get_llm_gateway()
        messages = [{"role": "user", "content": test_prompt}]
        response = gateway.complete(messages=messages, max_tokens=2048)
        duration_ms = round((time.monotonic() - started) * 1000, 2)

        config_keys = _PROVIDER_CONFIG_KEYS.get(backend)
        active_model = current_app.config.get(config_keys[2], "") if config_keys else "fake"

        return jsonify({
            "success": True,
            "status": "connected",
            "backend": backend,
            "model": active_model,
            "response": str(response).strip(),
            "latency_ms": duration_ms,
        })
    except Exception as exc:
        duration_ms = round((time.monotonic() - started) * 1000, 2)
        current_app.logger.warning("LLM test failed: %s", exc)
        return jsonify({
            "success": False,
            "status": "error",
            "backend": backend,
            "error": str(exc),
            "latency_ms": duration_ms,
        }), 400

