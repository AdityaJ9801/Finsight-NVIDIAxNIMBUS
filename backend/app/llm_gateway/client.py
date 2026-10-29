"""HTTP adapter speaking the OpenAI chat-completions/embeddings JSON shape.

Not just for a custom deployment: this one class backs the custom endpoint, OpenAI, AND
Gemini (via Google's OpenAI-compatibility endpoint) -- all three speak this same shape
natively, so provider selection (app/llm_gateway/__init__.py) is just a different
base_url/api_key/model_name, not a different client. Most self-hosted stacks (vLLM, TGI,
Ollama's OpenAI-compat mode, LM Studio, a custom FastAPI wrapper) speak it too. If your
deployment's request/response shape differs, this is the ONLY file that needs to change --
everything else in the app talks to the `LLMGateway` interface in base.py, not to this
HTTP shape directly.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Type, TypeVar

import requests
from pydantic import BaseModel, ValidationError

from app.llm_gateway.base import LLMGateway, LLMValidationError

T = TypeVar("T", bound=BaseModel)

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)

# (connect_timeout, read_timeout): connect timeout should fail fast (10s) if host is completely
# unreachable. The read timeout is configurable via LLM_TIMEOUT_S (default 90s) to give custom
# self-hosted LLM endpoints (e.g. vLLM, Ollama, remote OpenAI-compat servers) sufficient time to
# synthesize complex structured financial reports without prematurely triggering read timeouts.
_DEFAULT_CONNECT_TIMEOUT_S = float(os.environ.get("LLM_CONNECT_TIMEOUT_S", "10.0"))
_DEFAULT_READ_TIMEOUT_S = float(os.environ.get("LLM_TIMEOUT_S", "90.0"))
_HTTP_TIMEOUT_S = (_DEFAULT_CONNECT_TIMEOUT_S, _DEFAULT_READ_TIMEOUT_S)
_CIRCUIT_BREAKER_SECONDS = float(os.environ.get("LLM_CIRCUIT_BREAKER_S", "20.0"))
_MAX_HTTP_RETRIES = 1
_RETRY_BACKOFF_S = [0.5]


class RealLLMGateway(LLMGateway):
    def __init__(self, base_url: str, api_key: str, model_name: str, reasoning_model_name: str | None = None,
                 embeddings_enabled: bool = False, parallel_calls: bool = False,
                 max_concurrent_requests: int = 3, max_tokens: int = 8192,
                 temperature: float = 0.2,
                 timeout: tuple[float, float] | float | None = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name
        self.reasoning_model_name = reasoning_model_name
        self.embeddings_enabled = embeddings_enabled
        self.max_tokens = max_tokens
        self.temperature = float(temperature)
        self.parallel_calls = parallel_calls
        if timeout is None:
            self.timeout = _HTTP_TIMEOUT_S
        elif isinstance(timeout, (int, float)):
            self.timeout = (_DEFAULT_CONNECT_TIMEOUT_S, float(timeout))
        else:
            self.timeout = timeout
        effective_concurrency = max(1, max_concurrent_requests) if parallel_calls else 1
        self._effective_concurrency = effective_concurrency
        self._semaphore = threading.Semaphore(effective_concurrency)

        # High-performance persistent HTTP session with connection pooling
        self._session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=40)
        self._session.mount("http://", adapter)
        self._session.mount("https://", adapter)

        # Circuit breaker: if the remote provider is unresponsive/timing out, fail instantly
        self._circuit_open_until: float = 0.0

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _chat(self, messages: list[dict], temperature: float = 0.2, model: str | None = None,
              max_tokens: int | None = None, require_schema: bool = False) -> str:
        last_error: Exception | None = None
        active_max_tokens = max_tokens or self.max_tokens
        active_model = model or self.model_name
        with self._semaphore:
            for attempt in range(_MAX_HTTP_RETRIES + 1):
                try:
                    payload = {
                        "model": active_model,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": active_max_tokens,
                    }
                    # NVIDIA NIM thinking & parameter support
                    if "nvidia.com" in self.base_url or (active_model and "nvidia" in active_model.lower()):
                        payload["chat_template_kwargs"] = {"enable_thinking": True}
                        payload["top_p"] = 0.95

                    resp = self._session.post(
                        f"{self.base_url}/chat/completions",
                        headers=self._headers(),
                        json=payload,
                        timeout=self.timeout,
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    choice = data["choices"][0]
                    msg = choice.get("message", {})
                    content = msg.get("content") or ""
                    reasoning = msg.get("reasoning_content") or ""
                    if not content and reasoning:
                        content = reasoning

                    if choice.get("finish_reason") == "length":
                        if content and not require_schema:
                            return content
                        last_error = LLMValidationError(
                            f"response truncated at max_tokens={active_max_tokens} (finish_reason=length)"
                        )
                        active_max_tokens = max(int(active_max_tokens * 2), 4096)
                        if attempt < _MAX_HTTP_RETRIES:
                            continue
                        if content:
                            return content
                        raise last_error
                    # OpenAI-compatible shape: {"choices": [{"message": {"content": "..."}}]}
                    return content
                except requests.exceptions.RequestException as exc:
                    last_error = exc
                    if attempt < _MAX_HTTP_RETRIES:
                        wait_s = _RETRY_BACKOFF_S[min(attempt, len(_RETRY_BACKOFF_S) - 1)]
                        retry_after = exc.response.headers.get("Retry-After") if exc.response is not None else None
                        if retry_after is not None:
                            try:
                                wait_s = max(wait_s, float(retry_after))
                            except ValueError:
                                pass
                        time.sleep(wait_s)
        raise last_error

    def _invoke_chat(self, messages: list[dict], model: str | None = None, temperature: float | None = None,
                     max_tokens: int | None = None, require_schema: bool = False) -> str:
        temp = self.temperature if temperature is None else float(temperature)
        try:
            return self._chat(messages, temperature=temp, model=model, max_tokens=max_tokens, require_schema=require_schema)
        except TypeError:
            try:
                return self._chat(messages, temperature=temp, model=model)
            except TypeError:
                return self._chat(messages, temperature=temp)

    def complete(self, messages, schema: Type[T] | None = None, tier: str = "default", max_retries: int = 1,
                 max_tokens: int | None = None, temperature: float | None = None):
        fallback_to_fake = os.environ.get("LLM_FALLBACK_TO_FAKE", "false").strip().lower() in ("1", "true", "yes")
        now = time.time()
        if fallback_to_fake and now < self._circuit_open_until:
            from app.llm_gateway.fake_client import FakeLLMGateway
            return FakeLLMGateway().complete(messages, schema=schema, tier=tier)

        active_model = (
            self.reasoning_model_name
            if (tier in ("reasoning", "advanced") and self.reasoning_model_name)
            else self.model_name
        )

        # Adaptive token budgeting for instant speed
        if max_tokens is None:
            if schema and schema.__name__ in ("RouteDecision", "ClassificationResult", "AssistantDecision"):
                token_budget = 300
            elif schema and schema.__name__ in ("QAAnswerResult", "ChartCaptionSet", "ExplanationResult"):
                token_budget = 1200
            elif schema and schema.__name__ in ("FindingsSet", "InsightSet", "MappingSet"):
                token_budget = 2400
            else:
                token_budget = 4096
        else:
            token_budget = max_tokens

        try:
            if schema is None:
                return self._invoke_chat(messages, model=active_model, max_tokens=token_budget, temperature=temperature, require_schema=False)

            schema_hint = {
                "role": "system",
                "content": (
                    "Respond with ONLY a single JSON object matching this JSON Schema, no prose, "
                    f"no markdown fences:\n{json.dumps(schema.model_json_schema())}"
                ),
            }
            working_messages = [schema_hint] + messages
            last_error: Exception | None = None

            for attempt in range(max_retries + 1):
                raw = self._invoke_chat(working_messages, model=active_model, max_tokens=token_budget, require_schema=True)
                try:
                    payload = _extract_json(raw)
                    return schema.model_validate(payload)
                except (ValidationError, json.JSONDecodeError, ValueError) as exc:
                    last_error = exc
                    working_messages = working_messages + [
                        {"role": "assistant", "content": raw},
                        {"role": "user", "content": f"That was invalid: {exc}. Reply again with ONLY corrected JSON."},
                    ]

            raise LLMValidationError(f"LLM failed to produce valid {schema.__name__} after retries: {last_error}")
        except LLMValidationError:
            raise
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Real LLM call failed or timed out: %s", exc)
            fallback_to_fake = os.environ.get("LLM_FALLBACK_TO_FAKE", "false").strip().lower() in ("1", "true", "yes")
            if fallback_to_fake:
                logging.getLogger(__name__).warning(
                    "tripping circuit for %ss and falling back to instant deterministic engine", _CIRCUIT_BREAKER_SECONDS
                )
                self._circuit_open_until = time.time() + _CIRCUIT_BREAKER_SECONDS
                from app.llm_gateway.fake_client import FakeLLMGateway
                return FakeLLMGateway().complete(messages, schema=schema, tier=tier)
            raise

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self.embeddings_enabled:
            raise NotImplementedError(
                "LLM_EMBEDDINGS_ENABLED is false; vector_search falls back to a local "
                "HashingVectorizer instead of calling this."
            )
        resp = requests.post(
            f"{self.base_url}/embeddings",
            headers=self._headers(),
            json={"model": self.model_name, "input": texts},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        return [item["embedding"] for item in data["data"]]


def _find_balanced_json_object(text: str) -> str | None:
    """Scans for the first top-level {...} object, respecting string literals so braces
    inside quoted strings don't throw off the balance count. More robust than a greedy
    regex against models (e.g. Qwen3) that wrap the real answer in extra prose/braces."""
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
        else:
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
    return None


def _extract_json(raw: str) -> dict:
    # Reasoning models (e.g. Qwen3 with thinking enabled) prepend a <think>...</think>
    # block before the actual answer -- strip it first so braces used in the reasoning
    # prose (e.g. the model discussing example JSON) can't be mistaken for the real object.
    raw = _THINK_BLOCK_RE.sub("", raw).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        candidate = _find_balanced_json_object(raw)
        if candidate is None:
            raise
        return json.loads(candidate)
