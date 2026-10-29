from flask import current_app

from app.llm_gateway.base import LLMGateway
from app.llm_gateway.client import RealLLMGateway
from app.llm_gateway.fake_client import FakeLLMGateway

_instance: LLMGateway | None = None

# Priority order for LLM_BACKEND=auto: first provider in this list whose API key is
# actually set wins. "real" is the custom-deployed endpoint (LLM_API_KEY).
_AUTO_PRIORITY = ["nvidia", "real"]

# Each resolved backend name -> the current_app.config keys holding its
# (base_url, api_key, model_name, reasoning_model_name).
# Every provider here speaks the OpenAI chat-completions shape (NVIDIA NIM natively speaks it).
_PROVIDER_CONFIG_KEYS = {
    "real": ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL_NAME", None),
    "nvidia": ("NVIDIA_BASE_URL", "NVIDIA_API_KEY", "NVIDIA_MODEL_NAME", "NVIDIA_REASONING_MODEL_NAME"),
}


def reset_llm_gateway() -> None:
    """Clears the cached gateway instance so the next get_llm_gateway() reinitializes."""
    global _instance
    _instance = None


_DUMMY_KEY_PLACEHOLDERS = {
    "test-key-123",
    "placeholder",
    "your-api-key-here",
    "<your key>",
    "<your-api-key>",
    "change-me",
}


def is_configured_key(val: str | None) -> bool:
    if not val or not isinstance(val, str):
        return False
    return bool(val.strip()) and val.strip().lower() not in _DUMMY_KEY_PLACEHOLDERS


def resolve_backend(config) -> str:
    """LLM_BACKEND=auto (the default) picks whichever provider has an API key configured;
    any other value ("fake", "real", "openai", "openai_reasoning", "gemini", "gemini_reasoning")
    pins that one regardless."""
    backend = config.get("LLM_BACKEND", "auto")
    if backend not in ("auto", "reasoning", "auto_reasoning"):
        return backend

    prefer_reasoning = backend in ("reasoning", "auto_reasoning")
    for candidate in _AUTO_PRIORITY:
        api_key_field = _PROVIDER_CONFIG_KEYS[candidate][1]
        if is_configured_key(config.get(api_key_field)):
            if prefer_reasoning and f"{candidate}_reasoning" in _PROVIDER_CONFIG_KEYS:
                return f"{candidate}_reasoning"
            return candidate
    return "fake"



def get_llm_gateway() -> LLMGateway:
    """Returns the process-wide gateway instance, selected by LLM_BACKEND
    ('auto' | 'fake' | 'real' | 'openai' | 'openai_reasoning' | 'gemini' | 'gemini_reasoning').

    Everything downstream (agents) talks to this interface only, so pointing at a real LLM
    -- your custom deployment, OpenAI, or Gemini -- is a config change (see .env.example),
    not a code change.
    """
    global _instance
    backend = resolve_backend(current_app.config)

    config_keys = _PROVIDER_CONFIG_KEYS.get(backend)
    current_key = current_app.config.get(config_keys[1], "") if config_keys else ""
    current_model = current_app.config.get(config_keys[2], "") if config_keys else ""

    # Re-create if backend changed or credentials/model/concurrency/temperature changed dynamically
    configured_parallel = current_app.config.get("LLM_PARALLEL_CALLS", True)
    configured_max_requests = current_app.config.get("LLM_MAX_CONCURRENT_REQUESTS", 5)
    configured_temp = float(current_app.config.get("LLM_TEMPERATURE", 0.2))
    configured_tokens = int(current_app.config.get("LLM_MAX_TOKENS", 8192))
    expected_concurrency = max(1, configured_max_requests) if configured_parallel else 1

    if (
        _instance is None
        or getattr(_instance, "_backend_name", None) != backend
        or getattr(_instance, "api_key", None) != current_key
        or getattr(_instance, "model_name", None) != current_model
        or getattr(_instance, "parallel_calls", None) != configured_parallel
        or getattr(_instance, "_effective_concurrency", None) != expected_concurrency
        or getattr(_instance, "temperature", None) != configured_temp
        or getattr(_instance, "max_tokens", None) != configured_tokens
    ):
        if config_keys:
            base_url_key, api_key_key, model_key, reasoning_key = config_keys
            reasoning_model = current_app.config.get(reasoning_key) if reasoning_key else None
            _instance = RealLLMGateway(
                base_url=current_app.config[base_url_key],
                api_key=current_app.config[api_key_key],
                model_name=current_app.config[model_key],
                reasoning_model_name=reasoning_model,
                embeddings_enabled=current_app.config.get("LLM_EMBEDDINGS_ENABLED", False),
                parallel_calls=current_app.config.get("LLM_PARALLEL_CALLS", True),
                max_concurrent_requests=current_app.config.get("LLM_MAX_CONCURRENT_REQUESTS", 5),
                max_tokens=configured_tokens,
                temperature=configured_temp,
                timeout=(
                    float(current_app.config.get("LLM_CONNECT_TIMEOUT_S", 10.0)),
                    float(current_app.config.get("LLM_TIMEOUT_S", 90.0)),
                ),
            )
        else:
            _instance = FakeLLMGateway()
        _instance._backend_name = backend
    return _instance
