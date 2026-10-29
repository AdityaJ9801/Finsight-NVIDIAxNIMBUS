import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Cpu, Bot, Wrench, Zap, Play, Sliders } from "lucide-react";
import { api } from "../lib/api";
import { useLlmStatus } from "../lib/hooks";
import type { LlmStatus } from "../lib/types";
import { ErrorNote, Skeleton, Spinner } from "../components/ui";
import { useFeedback } from "../components/feedback";
import { AgentStudioView } from "../components/AgentStudio";
import { McpToolboxView } from "../components/McpToolbox";

const PROVIDERS: { value: string; label: string; model: (s: LlmStatus) => string; needs?: "nvidia" | "custom" }[] = [
  { value: "auto", label: "Automatic", model: () => "Uses configured key: NVIDIA NIM, then custom, then offline mock" },
  { value: "nvidia", label: "NVIDIA NIM", model: (s) => s.models?.nvidia_model ?? "nvidia/nemotron-3.5-super-vl-120b-a12b", needs: "nvidia" },
  { value: "real", label: "Custom endpoint", model: (s) => s.models?.custom_model ?? "Configured in .env", needs: "custom" },
  { value: "fake", label: "Offline mock", model: () => "No API calls. Deterministic answers for testing" },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"model" | "studio" | "mcp">("model");
  const { data, isLoading, error } = useLlmStatus();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [backend, setBackend] = useState("auto");
  const [parallel, setParallel] = useState(true);
  const [workers, setWorkers] = useState(5);
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  // Model name customization
  const [nvidiaModel, setNvidiaModel] = useState("");
  const [customModel, setCustomModel] = useState("");

  // Inference Tuning & Persona state
  const [temperature, setTemperature] = useState(0.2);
  const [personaPreset, setPersonaPreset] = useState("virtual_cfo");
  const [customSystemPrompt, setCustomSystemPrompt] = useState("");
  const [historyTurns, setHistoryTurns] = useState(6);
  const [fallbackCascade, setFallbackCascade] = useState(true);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [timeoutS, setTimeoutS] = useState(60.0);
  const [maxTokens, setMaxTokens] = useState(2048);

  // Model connectivity test
  const [testPrompt, setTestPrompt] = useState("Explain in one brief sentence why financial ratio analysis is vital for credit underwriting.");
  const [testResult, setTestResult] = useState<{ success: boolean; status: string; backend: string; model: string; response?: string; error?: string; latency_ms: number } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (data) {
      setBackend(data.configured_backend);
      setParallel(data.parallel_calls);
      setWorkers(data.max_concurrent_requests ?? 5);
      setNvidiaModel(data.models?.nvidia_model ?? "nvidia/nemotron-3.5-super-vl-120b-a12b");
      setCustomModel(data.models?.custom_model ?? "custom-model");
      setCustomBaseUrl(data.custom_base_url || data.models?.custom_base_url || "http://host.docker.internal:8000/v1");
      setTemperature(data.temperature ?? 0.2);
      setPersonaPreset(data.persona_preset ?? "virtual_cfo");
      setCustomSystemPrompt(data.custom_system_prompt ?? "");
      setHistoryTurns(data.history_turns ?? 6);
      setFallbackCascade(data.fallback_cascade ?? true);
      setShowTelemetry(data.show_telemetry ?? true);
      setTimeoutS(data.timeout_s ?? 60.0);
      setMaxTokens(data.max_tokens ?? 2048);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        backend,
        parallel_calls: parallel,
        max_concurrent_requests: workers,
        temperature,
        persona_preset: personaPreset,
        custom_system_prompt: customSystemPrompt,
        history_turns: historyTurns,
        fallback_cascade: fallbackCascade,
        show_telemetry: showTelemetry,
        timeout_s: timeoutS,
        max_tokens: maxTokens,
      };
      if (nvidiaKey.trim()) payload.nvidia_api_key = nvidiaKey.trim();
      if (nvidiaModel.trim()) payload.nvidia_model = nvidiaModel.trim();
      if (customKey.trim()) payload.custom_api_key = customKey.trim();
      if (customBaseUrl.trim()) payload.custom_base_url = customBaseUrl.trim();
      if (customModel.trim()) payload.custom_model = customModel.trim();
      return api.saveLlm(payload);
    },
    onSuccess: (status) => {
      qc.setQueryData(["llm"], status);
      setNvidiaKey(""); setCustomKey("");
      toast("Model, tuning, and worker settings saved.", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const handleTestModel = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testLlm({ prompt: testPrompt.trim() });
      setTestResult(res);
      if (res.success) {
        toast(`Connected to ${res.model} in ${res.latency_ms}ms`, "success");
      } else {
        toast(res.error || "Model test failed", "error");
      }
    } catch (err: any) {
      toast(err.message || "Failed to reach model test endpoint", "error");
      setTestResult({
        success: false,
        status: "error",
        backend: backend,
        model: data?.active_model || "unknown",
        error: err.message,
        latency_ms: 0,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const dirty = !!data && (
    backend !== data.configured_backend ||
    parallel !== data.parallel_calls ||
    workers !== (data.max_concurrent_requests ?? 5) ||
    temperature !== (data.temperature ?? 0.2) ||
    personaPreset !== (data.persona_preset ?? "virtual_cfo") ||
    customSystemPrompt !== (data.custom_system_prompt ?? "") ||
    historyTurns !== (data.history_turns ?? 6) ||
    fallbackCascade !== (data.fallback_cascade ?? true) ||
    showTelemetry !== (data.show_telemetry ?? true) ||
    timeoutS !== (data.timeout_s ?? 60.0) ||
    maxTokens !== (data.max_tokens ?? 2048) ||
    (nvidiaModel && nvidiaModel !== data.models?.nvidia_model) ||
    (customModel && customModel !== data.models?.custom_model) ||
    (customBaseUrl && customBaseUrl !== (data.custom_base_url || data.models?.custom_base_url)) ||
    !!nvidiaKey.trim() ||
    !!customKey.trim()
  );

  return (
    <div className="page page-form" style={{ maxWidth: activeTab === "model" ? "680px" : "1100px" }}>
      <header className="page-head" style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.01em" }}>Settings &amp; Multi-Agent Hub</h1>
        <p className="lede" style={{ fontSize: "0.9rem", color: "var(--ink-2, #4a5563)", margin: "0.35rem 0 1rem 0" }}>
          Configure model inference, custom multi-agent personas, system prompts, skills, and Model Context Protocol (FastMCP) toolsets.
        </p>

        {/* Modernized Tab Navigation */}
        <div
          style={{
            display: "inline-flex",
            gap: "0.25rem",
            padding: "0.25rem",
            backgroundColor: "var(--paper-sunk, #eef0ec)",
            borderRadius: "6px",
            border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("model")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.45rem 0.95rem",
              borderRadius: "4px",
              border: "none",
              backgroundColor: activeTab === "model" ? "var(--sheet, #ffffff)" : "transparent",
              color: activeTab === "model" ? "var(--ink, #16212e)" : "var(--graphite, #7a838f)",
              boxShadow: activeTab === "model" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "0.85rem",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <Cpu size={15} color={activeTab === "model" ? "var(--tick, #1a7f55)" : "currentColor"} />
            Models &amp; Workers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("studio")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.45rem 0.95rem",
              borderRadius: "4px",
              border: "none",
              backgroundColor: activeTab === "studio" ? "var(--sheet, #ffffff)" : "transparent",
              color: activeTab === "studio" ? "var(--ink, #16212e)" : "var(--graphite, #7a838f)",
              boxShadow: activeTab === "studio" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "0.85rem",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <Bot size={15} color={activeTab === "studio" ? "#0284c7" : "currentColor"} />
            Agent Studio &amp; Personas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("mcp")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.45rem 0.95rem",
              borderRadius: "4px",
              border: "none",
              backgroundColor: activeTab === "mcp" ? "var(--sheet, #ffffff)" : "transparent",
              color: activeTab === "mcp" ? "var(--ink, #16212e)" : "var(--graphite, #7a838f)",
              boxShadow: activeTab === "mcp" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "0.85rem",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <Wrench size={15} color={activeTab === "mcp" ? "#d97706" : "currentColor"} />
            MCP Toolset Box
          </button>
        </div>
      </header>

      {activeTab === "studio" && <AgentStudioView />}
      {activeTab === "mcp" && <McpToolboxView />}

      {activeTab === "model" && (
        error ? <ErrorNote error={error} /> : isLoading || !data ? <Skeleton h={320} /> : (
          <form className="settings" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="current">
            <span className="muted small">Currently answering</span>
            <strong>{data.resolved_backend === "fake" ? "Offline mock" : data.active_model}</strong>
            {data.resolved_backend === "fake" && <span className="small attention-text">Add a key below to get real analysis.</span>}
          </div>

          <fieldset className="field-group">
            <legend className="field-label">Provider</legend>
            <div className="choice-list">
              {PROVIDERS.map((p) => {
                const missingKey = p.needs && !data.keys_configured[p.needs] && !(p.needs === "nvidia" && nvidiaKey) && !(p.needs === "custom" && customKey);
                return (
                  <label key={p.value} className={`choice ${backend === p.value ? "choice-on" : ""}`}>
                    <input type="radio" name="backend" value={p.value} checked={backend === p.value} onChange={() => setBackend(p.value)} />
                    <span className="choice-body">
                      <span className="choice-title">{p.label}{missingKey && <span className="tag">Needs key</span>}</span>
                      <span className="choice-desc">{p.model(data)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="field-group">
            <KeyField id="nvidia" label="NVIDIA API Key" placeholder="nvapi-…" masked={data.masked_keys?.nvidia || ""} value={nvidiaKey} onChange={setNvidiaKey} />
          </div>

          {/* Custom Endpoint Settings */}
          <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <KeyField
              id="custom-key"
              label="Custom Endpoint API Key"
              placeholder="Authorization bearer token (or leave empty if local)"
              masked={data.masked_keys?.custom || ""}
              value={customKey}
              onChange={setCustomKey}
            />
            <div className="key-field">
              <label className="field-label" htmlFor="custom-base-url">Custom Endpoint Base URL</label>
              <input
                id="custom-base-url"
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="http://host.docker.internal:8000/v1"
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.85rem",
                  padding: "0.55rem 0.75rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  backgroundColor: "var(--sheet, #ffffff)",
                  color: "var(--ink, #16212e)",
                  width: "100%",
                }}
              />
            </div>
          </div>

          {/* Model Name Customization */}
          <div className="field-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="key-field">
              <label className="field-label" htmlFor="nvidia-model">NVIDIA Model (NIM)</label>
              <input
                id="nvidia-model"
                type="text"
                value={nvidiaModel}
                onChange={(e) => setNvidiaModel(e.target.value)}
                placeholder="nvidia/nemotron-3.5-super-vl-120b-a12b"
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.85rem",
                  padding: "0.55rem 0.75rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  backgroundColor: "var(--sheet, #ffffff)",
                  color: "var(--ink, #16212e)",
                  width: "100%",
                }}
              />
            </div>
            <div className="key-field">
              <label className="field-label" htmlFor="custom-model">Custom Model</label>
              <input
                id="custom-model"
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="custom-model, llama3.2"
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.85rem",
                  padding: "0.55rem 0.75rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  backgroundColor: "var(--sheet, #ffffff)",
                  color: "var(--ink, #16212e)",
                  width: "100%",
                }}
              />
            </div>
          </div>

          {/* Live Model Verification & Test Card */}
          <div
            style={{
              padding: "1.25rem",
              borderRadius: "6px",
              border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
              backgroundColor: "var(--paper-sunk, #eef0ec)",
              display: "flex",
              flexDirection: "column",
              gap: "0.85rem",
              marginBottom: "1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <strong style={{ fontSize: "0.95rem", color: "var(--ink, #16212e)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <Zap size={16} color="var(--tick, #1a7f55)" /> Live Model Verification &amp; Response Test
                </strong>
                <p className="small muted" style={{ margin: "2px 0 0 0" }}>
                  Send a live prompt to check if the active model backend is responding and verify its latency.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestModel}
                disabled={isTesting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.4rem 0.85rem",
                  fontSize: "0.85rem",
                  fontFamily: "'IBM Plex Sans', sans-serif",
                }}
              >
                {isTesting ? <><Spinner size={13} /> Testing…</> : <><Play size={13} /> Test Model</>}
              </button>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                placeholder="Enter test prompt..."
                style={{
                  flex: 1,
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.85rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  backgroundColor: "var(--sheet, #ffffff)",
                  color: "var(--ink, #16212e)",
                  fontFamily: "'IBM Plex Sans', sans-serif",
                }}
              />
            </div>

            {testResult && (
              <div
                style={{
                  padding: "0.85rem",
                  borderRadius: "4px",
                  backgroundColor: testResult.success ? "var(--tick-wash, #e8f3ed)" : "var(--redink-wash, #fbece9)",
                  border: `1px solid ${testResult.success ? "var(--tick, #1a7f55)" : "var(--redink, #b42318)"}`,
                  fontSize: "0.85rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                  <span
                    style={{
                      fontWeight: 600,
                      color: testResult.success ? "var(--tick-deep, #13654a)" : "var(--redink, #b42318)",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    {testResult.success ? "✓ Active & Connected" : "✕ Connection Failed"}
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, fontSize: "0.75rem" }}>
                      ({testResult.model} • {testResult.latency_ms}ms)
                    </span>
                  </span>
                </div>
                {testResult.success && testResult.response && (
                  <p style={{ margin: 0, color: "var(--ink, #16212e)", fontStyle: "italic", fontSize: "0.85rem" }}>
                    "{testResult.response}"
                  </p>
                )}
                {!testResult.success && testResult.error && (
                  <p style={{ margin: 0, color: "var(--redink, #b42318)", fontSize: "0.8rem", fontFamily: "'IBM Plex Mono', monospace" }}>
                    {testResult.error}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Inference Tuning & Financial Persona Card */}
          <div
            style={{
              padding: "1.25rem",
              borderRadius: "6px",
              border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
              backgroundColor: "var(--paper-sunk, #eef0ec)",
              display: "flex",
              flexDirection: "column",
              gap: "1.1rem",
              marginBottom: "1rem",
            }}
          >
            <div>
              <strong style={{ fontSize: "0.95rem", color: "var(--ink, #16212e)", display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <Sliders size={16} color="var(--tick, #1a7f55)" /> Inference Tuning &amp; Financial Persona
              </strong>
              <p className="small muted" style={{ margin: "2px 0 0 0" }}>
                Calibrate analytical tone, hallucination guardrails, temperature, and conversation memory depth for the Ask FinSight Chatbot.
              </p>
            </div>

            {/* Financial Persona Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <label className="field-label" style={{ margin: 0 }}>Analytical Persona Preset</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {[
                  { id: "virtual_cfo", label: "Virtual CFO", desc: "Fiduciary balance, cash flow bridges, EBITDA reconciliations" },
                  { id: "credit_auditor", label: "Conservative Credit Auditor", desc: "Downside haircuts, covenant thresholds, debt coverage ratios" },
                  { id: "forensic_examiner", label: "Forensic Accounting Examiner", desc: "Working capital anomalies, revenue timing, off-balance risks" },
                  { id: "custom", label: "Custom Persona", desc: "Define tailored analytical directives in system prompt" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPersonaPreset(item.id)}
                    style={{
                      textAlign: "left",
                      padding: "0.6rem 0.75rem",
                      borderRadius: "5px",
                      border: personaPreset === item.id ? "1.5px solid var(--tick, #1a7f55)" : "1px solid var(--rule-strong, rgba(22, 33, 46, 0.16))",
                      backgroundColor: personaPreset === item.id ? "var(--sheet, #ffffff)" : "rgba(255, 255, 255, 0.5)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "0.85rem", color: personaPreset === item.id ? "var(--tick-deep, #13654a)" : "var(--ink, #16212e)" }}>
                      {personaPreset === item.id ? "✓ " : ""}{item.label}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--graphite, #7a838f)", marginTop: "2px", lineHeight: "1.25" }}>
                      {item.desc}
                    </div>
                  </button>
                ))}
              </div>

              {personaPreset === "custom" && (
                <div style={{ marginTop: "0.5rem" }}>
                  <label className="field-label" htmlFor="custom-prompt">Custom Persona Directives</label>
                  <textarea
                    id="custom-prompt"
                    value={customSystemPrompt}
                    onChange={(e) => setCustomSystemPrompt(e.target.value)}
                    rows={3}
                    placeholder="Enter custom instructions (e.g. 'You are a distressed debt specialist focusing strictly on liquidation value...')"
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: "0.82rem",
                      borderRadius: "4px",
                      border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                      backgroundColor: "var(--sheet, #ffffff)",
                      color: "var(--ink, #16212e)",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Inference Temperature Slider & Presets */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="field-label" htmlFor="temp-slider" style={{ margin: 0 }}>
                  Inference Temperature
                </label>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", fontWeight: 600, color: "var(--ink, #16212e)" }}>
                  {temperature.toFixed(2)}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <input
                  id="temp-slider"
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  style={{ flex: 1, cursor: "pointer" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.2rem" }}>
                {[
                  { label: "0.0 Deterministic Audit", val: 0.0 },
                  { label: "0.2 Analytical CFO", val: 0.2 },
                  { label: "0.5 Balanced", val: 0.5 },
                  { label: "0.8 Exploratory", val: 0.8 },
                ].map((preset) => (
                  <button
                    key={preset.val}
                    type="button"
                    onClick={() => setTemperature(preset.val)}
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.25rem 0.6rem",
                      borderRadius: "3px",
                      border: temperature === preset.val ? "1px solid var(--tick, #1a7f55)" : "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
                      backgroundColor: temperature === preset.val ? "var(--tick-wash, #e8f3ed)" : "var(--sheet, #ffffff)",
                      color: temperature === preset.val ? "var(--tick-deep, #13654a)" : "var(--ink-2, #4a5563)",
                      fontWeight: temperature === preset.val ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="small muted" style={{ margin: "2px 0 0 0" }}>
                Lower values (0.00 – 0.20) eliminate hallucination and guarantee quantitative consistency against tabular balance sheets.
              </p>
            </div>

            {/* Conversation History Depth */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="field-label" style={{ margin: 0 }}>Conversation Context Window</label>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: "var(--ink-2, #4a5563)" }}>
                  {historyTurns} turns
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                {[2, 4, 6, 8, 12].map((turns) => (
                  <button
                    key={turns}
                    type="button"
                    onClick={() => setHistoryTurns(turns)}
                    style={{
                      fontSize: "0.78rem",
                      padding: "0.25rem 0.65rem",
                      borderRadius: "3px",
                      border: historyTurns === turns ? "1px solid var(--tick, #1a7f55)" : "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
                      backgroundColor: historyTurns === turns ? "var(--tick-wash, #e8f3ed)" : "var(--sheet, #ffffff)",
                      color: historyTurns === turns ? "var(--tick-deep, #13654a)" : "var(--ink-2, #4a5563)",
                      fontWeight: historyTurns === turns ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {turns} turns
                  </button>
                ))}
              </div>
            </div>

            {/* Telemetry and Resilience Toggles */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", paddingTop: "0.3rem", borderTop: "1px solid var(--rule, rgba(22, 33, 46, 0.1))" }}>
              <label className="switch switch-row" style={{ margin: 0 }}>
                <input type="checkbox" checked={showTelemetry} onChange={(e) => setShowTelemetry(e.target.checked)} />
                <span className="switch-track" />
                <span>
                  <span className="choice-title" style={{ fontSize: "0.85rem" }}>Show Runtime Telemetry in Chatbot</span>
                  <span className="choice-desc" style={{ fontSize: "0.75rem" }}>Display latency, active model, persona badge, and temperature on assistant responses.</span>
                </span>
              </label>

              <label className="switch switch-row" style={{ margin: 0 }}>
                <input type="checkbox" checked={fallbackCascade} onChange={(e) => setFallbackCascade(e.target.checked)} />
                <span className="switch-track" />
                <span>
                  <span className="choice-title" style={{ fontSize: "0.85rem" }}>Enable Gateway Resilience Cascade</span>
                  <span className="choice-desc" style={{ fontSize: "0.75rem" }}>Automatically fallback to alternative configured backends if primary rate-limits or times out.</span>
                </span>
              </label>
            </div>
          </div>

          <div className="worker-settings-card">
            <label className="switch switch-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={parallel} onChange={(e) => setParallel(e.target.checked)} />
              <span className="switch-track" />
              <span>
                <span className="choice-title">Run tasks &amp; agents in parallel</span>
                <span className="choice-desc">Fans out document parsing, financial analysis modules, and charts simultaneously for maximum speed.</span>
              </span>
            </label>

            {parallel && (
              <div className="worker-slider-wrap">
                <div className="worker-header-row">
                  <label className="field-label" htmlFor="worker-slider" style={{ margin: 0 }}>
                    Concurrent Workers
                  </label>
                  <span className="worker-badge">
                    {workers} parallel worker{workers === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="worker-slider-controls">
                  <input
                    id="worker-slider"
                    type="range"
                    className="worker-range-input"
                    min={1}
                    max={20}
                    step={1}
                    value={workers}
                    onChange={(e) => setWorkers(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  />
                  <input
                    type="number"
                    className="worker-num-input"
                    min={1}
                    max={20}
                    value={workers}
                    onChange={(e) => setWorkers(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    aria-label="Worker count"
                  />
                </div>

                <div className="worker-preset-pills">
                  <span className="small muted">Speed Presets:</span>
                  {[
                    { label: "2 (Conservative)", count: 2 },
                    { label: "5 (Balanced)", count: 5 },
                    { label: "8 (Fast Fan-out)", count: 8 },
                    { label: "12 (Turbo)", count: 12 },
                    { label: "16 (Max)", count: 16 },
                  ].map((preset) => (
                    <button
                      key={preset.count}
                      type="button"
                      className={`worker-pill ${workers === preset.count ? "active" : ""}`}
                      onClick={() => setWorkers(preset.count)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <p className="small muted" style={{ margin: 0 }}>
                  Controls how many worker threads and simultaneous model requests execute concurrently across document ingestion, financial analysis modules, and delivery DAG generation.
                </p>
              </div>
            )}
          </div>

          <div className="compose-actions">
            <button className="btn btn-primary" disabled={!dirty || save.isPending}>{save.isPending ? <><Spinner /> Saving…</> : "Save settings"}</button>
          </div>
        </form>
      ))}
    </div>
  );
}

function KeyField({ id, label, placeholder, masked, value, onChange }: {
  id: string; label: string; placeholder: string; masked: string; value: string; onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="key-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="input-affix">
        <input id={id} type={show ? "text" : "password"} autoComplete="off" spellCheck={false} value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={masked ? `Saved: ${masked}. Enter a new key to replace it` : placeholder} />
        <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? "Hide key" : "Show key"}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </div>
    </div>
  );
}
