import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Brain,
  Compass,
  Copy,
  FileText,
  Network,
  RotateCcw,
  Sparkles,
  Table as TableIcon,
  X,
  Zap,
  Sliders,
} from "lucide-react";
import { api } from "../lib/api";
import { refreshResults, useLlmStatus } from "../lib/hooks";
import { agentDef, isActive } from "../lib/pipeline";
import { METRICS, metricLabel } from "../lib/format";
import type { Chart, Instruction, Job, QaResponse, RenderedOutput, SearchPlan, AgentDialogueStep } from "../lib/types";
import { Spinner } from "./ui";

interface Option { label: string; description: string; agent: string }

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  kind?: "steer" | "error";
  instructionId?: string;
  meta?: string;
  citations?: string[];
  options?: Option[];
  answered?: boolean;
  chart?: Chart;
  report_updated?: boolean;
  tool_used?: string;
  format?: string;
  rendered_output?: RenderedOutput;
  search_plan?: SearchPlan;
  telemetry?: {
    latency_ms: number;
    model: string;
    persona: string;
    temperature: number;
    search_plan?: SearchPlan;
  };
}

function formatPersona(p?: string) {
  if (!p) return "Virtual CFO";
  if (p === "virtual_cfo") return "Virtual CFO";
  if (p === "credit_auditor") return "Credit Auditor";
  if (p === "forensic_examiner") return "Forensic Examiner";
  if (p === "custom") return "Custom Persona";
  return p.replace(/_/g, " ");
}

function sourceLabel(c: string) {
  if (METRICS[c]) return metricLabel(c);
  if (c === "report_findings") return "analysis findings";
  if (c.startsWith("query_result")) return "computed metrics";
  if (c.includes(".pdf") || c.includes(".xlsx") || c.includes(".csv") || c.includes("Page")) return c;
  return c.replace(/_/g, " ");
}

const storeKey = (jobId: string) => `finsight.chat.${jobId}`;
const AUTO_KEY = "finsight.autoDecide";
const FORMAT_KEY = "finsight.chatFormat";
const uid = () => Math.random().toString(36).slice(2, 10);

export type OutputFormat = "auto" | "narrative" | "table" | "chart" | "diagnostic" | "agent_trace" | "memory";

const OUTPUT_FORMATS: { id: OutputFormat; label: string; hint: string }[] = [
  { id: "auto", label: "Auto (Adaptive)", hint: "Smart layout adaptation based on query" },
  { id: "narrative", label: "Executive Narrative", hint: "Executive CFO commentary & analysis" },
  { id: "table", label: "Structured Table", hint: "Tabular breakdown & CSV export" },
  { id: "chart", label: "Dynamic Chart", hint: "Dynamic visual chart & plot" },
  { id: "diagnostic", label: "CFO Diagnostic Tree", hint: "Virtual CFO multi-tier root-cause tree" },
  { id: "agent_trace", label: "Agent Trace", hint: "Agent telemetry, DAG status & findings" },
  { id: "memory", label: "Strategic Memory", hint: "Cross-job strategic observations" },
];

const DEFAULT_PROMPTS = [
  "Run DuPont 3-way ROE decomposition in a table",
  "Generate a chart of Revenue vs EBITDA Margin over time",
  "Diagnose why PAT dropped using the CFO diagnostic tree",
  "@risk Check anomalies and composite credit default risk",
  "What is the financial health score and rating breakdown?",
  "What do the document notes say about debt covenants?",
];

const DONE_NOTE: Record<string, string> = {
  ratio: "Ratios, margins and trend findings recomputed.",
  cash_wc: "Cash flow metrics, cycles and findings recomputed.",
  forecast: "Forward projections and forecast findings recomputed.",
  risk: "Risk score, anomalies and red flags recomputed.",
  gst: "GST reconciliation recomputed against the ledger.",
  detailed_analytics: "Horizontal, vertical and DuPont analyses recomputed.",
  insight_reasoner: "Cross-module insights and health score updated.",
  chart_spec: "Visual charts regenerated.",
  report_writer: "Executive report regenerated and verified.",
};

export function ChatPanel({
  job,
  instructions = [],
  onClose,
  onNavigateTab,
  fullView = false,
}: {
  job: Job;
  instructions?: Instruction[];
  onClose?: () => void;
  onNavigateTab?: (tab: string) => void;
  fullView?: boolean;
}) {
  const qc = useQueryClient();
  const { data: llmConfig } = useLlmStatus();
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const raw = localStorage.getItem(storeKey(job.id));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Working it out…");
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) === "1");
  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>(() => {
    return (localStorage.getItem(FORMAT_KEY) as OutputFormat) || "auto";
  });

  const [chatZoom, setChatZoom] = useState<Chart | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const steering = isActive(job.status);
  const canAsk = !!job.dataset_version_id;
  const disabled = !steering && !canAsk;

  const insById = new Map<string, Instruction>(instructions.map((i) => [i.id, i]));

  useEffect(() => {
    try {
      localStorage.setItem(storeKey(job.id), JSON.stringify(msgs));
    } catch {
      // Storage full or quota exceeded
    }
  }, [msgs, job.id]);

  useEffect(() => {
    localStorage.setItem(AUTO_KEY, auto ? "1" : "0");
  }, [auto]);

  useEffect(() => {
    localStorage.setItem(FORMAT_KEY, selectedFormat);
  }, [selectedFormat]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const push = (m: Omit<Msg, "id">) => setMsgs((cur) => [...cur, { ...m, id: uid() }]);
  const history = () => msgs.filter((m) => !m.kind && !m.options).slice(-4).map((m) => ({ role: m.role, content: m.text }));

  async function runAssistant(payload: { message?: string; chosen_agent?: string; action_note?: string; force?: boolean }) {
    const formatReq = selectedFormat;
    const textMsg = payload.message || "";
    const isChart = /chart|plot|graph|visual/i.test(textMsg);

    // If explicit agent re-run was chosen from clarification or force re-run action
    if (payload.chosen_agent || payload.force) {
      const res = await api.assistant(job.id, { ...payload, auto });
      if (res.type === "clarification") {
        push({ role: "assistant", text: res.question, options: res.options });
        return;
      }
      if (!res.agent_used) {
        push({
          role: "assistant",
          text: "I couldn't tell which part of the analysis to run. Try specifying an agent like `@ratio` or a tool like `/tool dupont`.",
        });
        return;
      }
      push({
        role: "assistant",
        text: res.answer,
        meta: DONE_NOTE[res.agent_used] ?? `Re-ran ${agentDef(res.agent_used).label}.`,
        report_updated: res.agent_used === "report_writer" || (res as any).report_updated,
        chart: (res as any).chart ?? undefined,
        tool_used: res.agent_used,
      });
      refreshResults(qc, job.id);
      return;
    }

    // Standard & analytical financial questions execute directly through FinSight Copilot LangGraph Harness:
    // 1. Understand user question first (intent, domain, targeted metrics)
    // 2. Select correct tools (data_query_facts, cfo_diagnostic, search_document_rag, tavily_validate_value)
    // 3. Formulate targeted queries and synthesize grounded forensic response
    setBusyLabel(isChart ? "Synthesizing dynamic chart…" : "Executing FinSight Copilot agent harness…");
    try {
      const qa: QaResponse = await api.qa(job.id, textMsg, history(), formatReq);
      if (qa.route === "action_request") {
        setBusyLabel("Running customized analysis…");
        await runAssistant({ message: payload.message, force: true });
        return;
      }
      const activeChart = qa.chart ?? qa.rendered_output?.chart ?? undefined;
      push({
        role: "assistant",
        text: qa.answer,
        citations: qa.citations,
        chart: activeChart,
        tool_used: qa.tool_used ?? "data_query_facts",
        report_updated: qa.report_updated,
        format: qa.format || formatReq,
        rendered_output: qa.rendered_output,
        search_plan: qa.search_plan || qa.rendered_output?.search_plan,
        telemetry: qa.telemetry,
      });
      if (activeChart) refreshResults(qc, job.id);
    } catch (err: any) {
      push({
        role: "assistant",
        text: err.message || "An unexpected error occurred in FinSight Copilot.",
        kind: "error",
      });
    }
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    push({ role: "user", text: q, kind: steering ? "steer" : undefined });
    setBusyLabel(steering ? "Sending guidance…" : "Synthesizing with LangGraph & agents…");
    setBusy(true);
    try {
      if (steering) {
        const ins = await api.addInstruction(job.id, q);
        setMsgs((cur) => cur.map((m, i) => (i === cur.length - 1 ? { ...m, instructionId: ins.id } : m)));
        qc.invalidateQueries({ queryKey: ["instructions", job.id] });
      } else {
        await runAssistant({ message: q });
      }
    } catch (e: any) {
      push({ role: "assistant", text: e.message || "An unexpected error occurred.", kind: "error" });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <aside className={`chat ${fullView ? "chat-full-view" : ""}`} aria-label="FinSight Copilot">
      {/* Top Header */}
      <div className="chat-head" style={{ padding: fullView ? "14px 22px" : "12px 16px", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "var(--tick-wash, #e8f3ed)",
              border: "1px solid var(--tick, #1a7f55)",
              display: "grid",
              placeItems: "center",
              color: "var(--tick-deep, #13654a)",
              flexShrink: 0,
            }}
          >
            <Sparkles size={15} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>
                {steering ? "Pipeline Guidance" : "FinSight Copilot"}
              </h2>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  fontFamily: "'IBM Plex Mono', monospace",
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "var(--paper-sunk)",
                  color: "var(--ink-2)",
                  border: "1px solid var(--rule-strong)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--tick, #1a7f55)" }} />
                {llmConfig?.active_model || "model"} • {formatPersona(llmConfig?.persona_preset)} • T:{llmConfig?.temperature !== undefined ? llmConfig.temperature.toFixed(2) : "0.20"}
              </span>
            </div>
            <p style={{ margin: "2px 0 0 0", fontSize: 11, color: "var(--graphite)" }}>
              {steering
                ? "Direct steer active pipeline agents during document analysis"
                : "Multi-agent LangGraph copilot grounded in audited financial statements"}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onNavigateTab && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => onNavigateTab("settings")}
              title="Tune Inference & Persona in Settings"
              style={{ width: 28, height: 28, borderRadius: 4 }}
            >
              <Sliders size={13} />
            </button>
          )}
          {msgs.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMsgs([])}
              title="Clear conversation"
              style={{ width: 28, height: 28, borderRadius: 4 }}
            >
              <RotateCcw size={13} />
            </button>
          )}
          {!fullView && onClose && (
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              title="Close panel"
              style={{ width: 28, height: 28, borderRadius: 6 }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Main Chat Scroll View - Always Visible */}
      <div className="chat-scroll" ref={scrollRef} aria-live="polite">
          {!msgs.length && (
            <div className="chat-empty" style={{ padding: "16px 0" }}>
              {disabled ? (
                <p className="muted small">Questions open once financial statements have been read and reconciled.</p>
              ) : (
                <>
                  <p className="small" style={{ margin: "0 0 12px 0", color: "var(--ink-2)", lineHeight: 1.5 }}>
                    Grounded in audited financial statements, ratios, and LangGraph multi-agent reasoning.
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {DEFAULT_PROMPTS.map((p) => (
                      <button key={p} className="prompt" onClick={() => send(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {msgs.map((m) => (
            <div key={m.id} className={`msg msg-${m.role} ${m.kind === "error" ? "msg-error" : ""}`}>
              {m.role === "user" ? (
                <div className="msg-user-text">
                  {m.kind === "steer" && <span className="steer-tag"><Compass size={12} /> Guidance</span>}
                  {m.text}
                  {m.instructionId && <InstructionStatus ins={insById.get(m.instructionId)} />}
                </div>
              ) : (
                <div className="msg-answer">
                  {/* Tool / Agent Execution Pill */}
                  {m.tool_used && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "2px 8px",
                        borderRadius: 12,
                        background: "var(--paper-sunk)",
                        border: "1px solid var(--rule)",
                        fontSize: 10,
                        color: "var(--graphite)",
                        marginBottom: 6,
                        fontWeight: 600,
                      }}
                    >
                      <Zap size={11} color="var(--tick)" /> {m.tool_used.replace(/_/g, " ").toUpperCase()}
                      {m.format && m.format !== "narrative" && (
                        <span style={{ color: "var(--ink-2)", marginLeft: 4 }}>• {m.format.toUpperCase()}</span>
                      )}
                    </div>
                  )}

                  {/* FinSight Agentic Plan (Question Understanding -> Tool Selection -> Query Formulation) */}
                  {m.search_plan && (
                    <AgenticPlanBadge plan={m.search_plan} />
                  )}

                  {/* FinSight Agent-to-Agent Talk (A2A Multi-Agent Coordination Protocol) */}
                  {(m.rendered_output?.a2a_dialogue || m.search_plan?.a2a_dialogue) && (
                    <AgentToAgentDialogueBadge dialogue={m.rendered_output?.a2a_dialogue || m.search_plan?.a2a_dialogue || []} />
                  )}

                  {/* Markdown Answer Text */}
                  <div className="prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  </div>

                  {/* Render Table Output if structured table is present */}
                  {m.rendered_output?.table && (
                    <RenderTableOutput table={m.rendered_output.table} />
                  )}

                  {/* Render Diagnostic Tree Output if present */}
                  {m.rendered_output?.diagnostic && (
                    <RenderDiagnosticTree diagnostic={m.rendered_output.diagnostic} />
                  )}

                  {/* Render Agent Trace Card if present */}
                  {m.rendered_output?.agent && (
                    <RenderAgentTrace agent={m.rendered_output.agent} />
                  )}

                  {/* Render Memory Card if present */}
                  {m.rendered_output?.memory && (
                    <RenderMemoryCard memory={m.rendered_output.memory} />
                  )}

                  {/* Render Dynamic Chart on-the-fly inside chat */}
                  {(() => {
                    const chartToDisplay = m.chart || m.rendered_output?.chart;
                    if (!chartToDisplay) return null;
                    return (
                      <figure className="chat-chart" style={{ marginTop: 10, marginBottom: 10, borderRadius: 6, overflow: "hidden", border: "1px solid var(--rule)", background: "var(--sheet)" }}>
                        <button
                          type="button"
                          style={{ border: "none", background: "none", padding: 0, width: "100%", cursor: "pointer", display: "block" }}
                          onClick={() => setChatZoom(chartToDisplay)}
                          aria-label={`Enlarge ${chartToDisplay.title}`}
                        >
                          <img src={chartToDisplay.png_base64} alt={chartToDisplay.title} style={{ width: "100%", display: "block" }} />
                        </button>
                        <figcaption style={{ padding: "8px 12px", background: "var(--paper-sunk)", borderTop: "1px solid var(--rule)", fontSize: 12 }}>
                          <strong style={{ display: "block", color: "var(--ink)", marginBottom: 2 }}>{chartToDisplay.title}</strong>
                          {chartToDisplay.takeaway && <span style={{ color: "var(--graphite)" }}>{chartToDisplay.takeaway}</span>}

                          {/* Breakdown Matrix Pills if available */}
                          {(chartToDisplay as any).breakdown && Array.isArray((chartToDisplay as any).breakdown) && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                              {(chartToDisplay as any).breakdown.map((item: any) => (
                                <div
                                  key={item.label}
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: 4,
                                    backgroundColor: "#ffffff",
                                    border: "1px solid var(--rule)",
                                    fontSize: 10.5,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                  }}
                                >
                                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{item.label}:</span>
                                  <span style={{ color: "var(--ink-2)", fontFamily: "'IBM Plex Mono', monospace" }}>{item.formatted}</span>
                                  <span style={{ color: "#0284c7", fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>({item.percentage}%)</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {onNavigateTab && (
                            <div style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                className="prompt"
                                style={{ padding: "3px 8px", fontSize: 11, fontWeight: 500 }}
                                onClick={() => onNavigateTab("charts")}
                              >
                                Explore in Charts View →
                              </button>
                            </div>
                          )}
                        </figcaption>
                      </figure>
                    );
                  })()}

                  {/* Citations pill list */}
                  {m.citations && m.citations.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                      {m.citations.map((c) => (
                        <span
                          key={c}
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: "var(--paper-sunk)",
                            color: "var(--graphite)",
                            border: "1px solid var(--rule)",
                            fontFamily: "'IBM Plex Mono', monospace",
                          }}
                        >
                          📎 {sourceLabel(c)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Customized Report Card with direct navigation */}
                  {m.report_updated && (
                    <div style={{ marginTop: 10, marginBottom: 10, padding: "12px 14px", border: "1px solid var(--rule-strong)", borderRadius: "var(--r-md)", background: "var(--paper-sunk)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tick-deep)", display: "flex", alignItems: "center", gap: 5 }}>
                          <FileText size={13} /> Customized Report Updated &amp; Verified
                        </span>
                        <span style={{ fontSize: 11, color: "var(--graphite)" }}>Published</span>
                      </div>
                      <p style={{ fontSize: 12, margin: "0 0 10px 0", color: "var(--ink-2)" }}>
                        The customized report has been regenerated and re-verified. View the synthesized findings, charts, and audit tables in the Report view.
                      </p>
                      {onNavigateTab && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: 12, fontWeight: 500 }}
                          onClick={() => onNavigateTab("report")}
                        >
                          Open Updated Report →
                        </button>
                      )}
                    </div>
                  )}

                  {/* Runtime Execution Telemetry */}
                  {m.telemetry && (llmConfig?.show_telemetry !== false) && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 8,
                        padding: "2px 7px",
                        borderRadius: 3,
                        background: "var(--paper-sunk)",
                        border: "1px solid var(--rule)",
                        fontSize: 10,
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: "var(--graphite)",
                      }}
                    >
                      <span>⏱ {m.telemetry.latency_ms}ms</span>
                      <span>•</span>
                      <span>{m.telemetry.model}</span>
                      <span>•</span>
                      <span>{formatPersona(m.telemetry.persona)}</span>
                      <span>•</span>
                      <span>T:{m.telemetry.temperature.toFixed(2)}</span>
                    </div>
                  )}

                  {/* Clarification Options */}
                  {m.options && (
                    <div className="options" style={{ marginTop: 8 }}>
                      {m.options.map((opt) => (
                        <button
                          key={opt.agent}
                          className="option"
                          disabled={busy}
                          onClick={() => runAssistant({ chosen_agent: opt.agent, action_note: opt.description, force: true })}
                        >
                          <span className="option-label">{opt.label}</span>
                          <span className="option-desc">{opt.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="msg msg-assistant">
              <div className="typing"><Spinner size={12} /> {busyLabel}</div>
            </div>
          )}
      </div>

      {/* Streamlined Message Composer */}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }} style={{ margin: "10px 14px 14px" }}>
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={
            disabled
              ? "Available once financial statements are loaded"
              : steering
              ? "Add guidance for pipeline agents during processing…"
              : "Ask about ratios, EBITDA bridges, DuPont, or request charts & tables (Enter to send)…"
          }
          aria-label="Message"
          style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
        />
        <div className="composer-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderTop: "1px solid var(--rule)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Minimalist Format Selector */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: "var(--graphite)", textTransform: "uppercase" }}>
                Format:
              </span>
              <select
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value as OutputFormat)}
                style={{
                  fontSize: 11,
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  padding: "2px 6px",
                  borderRadius: 3,
                  border: "1px solid var(--rule)",
                  background: "var(--sheet)",
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
                aria-label="Output format"
              >
                {OUTPUT_FORMATS.map((fmt) => (
                  <option key={fmt.id} value={fmt.id}>
                    {fmt.label}
                  </option>
                ))}
              </select>
            </div>

            {!steering && (
              <label className="switch" style={{ fontSize: 11, color: "var(--graphite)" }} title="Automatically dispatch the best matching agent when multiple can answer">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                <span className="switch-track" /> Auto-decide
              </label>
            )}
          </div>

          <button className="send" type="submit" disabled={!input.trim() || busy || disabled} aria-label="Send">
            <ArrowUp size={15} />
          </button>
        </div>
      </form>

      {/* Lightbox for zooming dynamic charts */}
      {chatZoom && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setChatZoom(null)}>
          <figure className="lightbox" role="dialog" aria-modal="true" aria-label={chatZoom.title}>
            <button className="icon-btn lightbox-close" onClick={() => setChatZoom(null)} aria-label="Close">
              <X size={18} />
            </button>
            <img src={chatZoom.png_base64} alt={chatZoom.title} />
            <figcaption>
              <strong>{chatZoom.title}</strong>
              {chatZoom.caption && <span>{chatZoom.caption}</span>}
            </figcaption>
          </figure>
        </div>
      )}
    </aside>
  );
}

// ============================================================================
// RICH OUTPUT RENDERERS (RENDER DIFFERENT OUTPUTS BASED ON USER REQUIREMENT)
// ============================================================================

function AgenticPlanBadge({ plan }: { plan: SearchPlan }) {
  const [open, setOpen] = useState(false);
  if (!plan) return null;

  return (
    <div
      style={{
        margin: "6px 0 10px 0",
        borderRadius: 6,
        border: "1px solid var(--rule-strong)",
        background: "var(--paper-sunk)",
        fontSize: 11,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--ink)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 3,
              background: "var(--tick-wash, #e8f3ed)",
              color: "var(--tick-deep, #13654a)",
              fontWeight: 600,
              fontSize: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Compass size={11} /> AGENTIC PLAN
          </span>
          <span style={{ fontWeight: 500, color: "var(--ink)" }}>
            {plan.intent_summary || "Financial Query Analysis"}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "var(--graphite)", fontFamily: "'IBM Plex Mono', monospace" }}>
          {open ? "Hide Strategy ▲" : "View Strategy ▼"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "8px 12px 10px", borderTop: "1px solid var(--rule)", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Step 1: Question Understanding */}
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, alignItems: "baseline" }}>
            <span style={{ color: "var(--graphite)", fontWeight: 600 }}>🎯 Understood Intent:</span>
            <span style={{ color: "var(--ink)" }}>{plan.intent_summary}</span>
          </div>

          {/* Step 2: Tool Selection */}
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, alignItems: "center" }}>
            <span style={{ color: "var(--graphite)", fontWeight: 600 }}>🛠️ Tools Selected:</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {plan.selected_tools?.map((t) => (
                <span
                  key={t}
                  style={{
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: "var(--sheet)",
                    border: "1px solid var(--rule)",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "var(--ink)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Zap size={9} color="var(--tick)" /> {t}
                </span>
              ))}
            </div>
          </div>

          {/* Step 3: Targeted Search Queries */}
          {plan.rag_query && (
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, alignItems: "baseline" }}>
              <span style={{ color: "var(--graphite)", fontWeight: 600 }}>📄 Document RAG:</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-2)" }}>
                "{plan.rag_query}"
              </span>
            </div>
          )}

          {plan.tavily_query && (
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, alignItems: "baseline" }}>
              <span style={{ color: "var(--graphite)", fontWeight: 600 }}>🌐 Tavily Web Query:</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--ink-2)" }}>
                "{plan.tavily_query}"
              </span>
            </div>
          )}

          {plan.diagnostic_metric_label && (
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, alignItems: "baseline" }}>
              <span style={{ color: "var(--graphite)", fontWeight: 600 }}>🔬 Diagnostic Tree:</span>
              <span style={{ fontSize: 11, color: "var(--ink-2)" }}>
                {plan.diagnostic_metric_label}
              </span>
            </div>
          )}

          {plan.metric_codes && plan.metric_codes.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, alignItems: "baseline" }}>
              <span style={{ color: "var(--graphite)", fontWeight: 600 }}>📊 Targeted Metrics:</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "var(--graphite)" }}>
                {plan.metric_codes.join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentToAgentDialogueBadge({ dialogue }: { dialogue: AgentDialogueStep[] }) {
  const [open, setOpen] = useState(true);
  if (!dialogue || dialogue.length === 0) return null;

  return (
    <div
      style={{
        margin: "6px 0 10px 0",
        borderRadius: 6,
        border: "1px solid rgba(2, 132, 199, 0.25)",
        background: "#f0f9ff",
        fontSize: 11,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "#0369a1",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 3,
              background: "#0284c7",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Network size={11} /> AGENT-TO-AGENT TALK
          </span>
          <span style={{ fontWeight: 600, color: "#0c4a6e", fontFamily: "'IBM Plex Mono', monospace" }}>
            {dialogue.length} Inter-Agent Synapses Connected
          </span>
        </div>
        <span style={{ fontSize: 10, color: "#0284c7", fontFamily: "'IBM Plex Mono', monospace" }}>
          {open ? "Hide Dialogue ▲" : "Inspect A2A Dialogue ▼"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "8px 12px 10px", borderTop: "1px solid rgba(2, 132, 199, 0.15)", display: "flex", flexDirection: "column", gap: 6 }}>
          {dialogue.map((step) => (
            <div
              key={step.step}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                padding: "6px 8px",
                borderRadius: 4,
                backgroundColor: "#ffffff",
                border: "1px solid rgba(2, 132, 199, 0.15)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      backgroundColor: "#0284c7",
                      color: "#ffffff",
                      fontSize: 9,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {step.step}
                  </span>
                  <strong style={{ color: "#0f172a", fontSize: 11 }}>{step.from_agent}</strong>
                  <span style={{ color: "#64748b", fontSize: 10 }}>➔</span>
                  <strong style={{ color: "#0284c7", fontSize: 11 }}>{step.to_agent}</strong>
                </div>

                {step.tool && (
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9.5,
                      padding: "1px 6px",
                      borderRadius: 3,
                      backgroundColor: "#e0f2fe",
                      color: "#0369a1",
                      border: "1px solid #7dd3fc",
                      fontWeight: 600,
                    }}
                  >
                    ⚡ MCP: {step.tool}
                  </span>
                )}
              </div>
              <div style={{ color: "#334155", fontSize: 11, lineHeight: 1.4, paddingLeft: 21 }}>
                {step.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RenderTableOutput({ table }: { table: { columns: string[]; rows: (string | number)[][]; summary?: string } }) {
  const [copied, setCopied] = useState(false);

  function copyCsv() {
    const header = table.columns.join(",");
    const rows = table.rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    const csv = [header, ...rows].join("\n");
    navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 10,
        border: "1px solid var(--rule)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--sheet)",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          background: "var(--paper-sunk)",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 5 }}>
          <TableIcon size={12} color="var(--tick-deep)" />
          {table.summary || "Structured Output Table"} ({table.rows.length} rows)
        </span>
        <button
          type="button"
          onClick={copyCsv}
          style={{
            border: "none",
            background: "none",
            fontSize: 10,
            color: "var(--graphite)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Copy size={11} /> {copied ? "Copied CSV!" : "Copy CSV"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "left" }}>
          <thead>
            <tr style={{ background: "var(--paper-sunk)", borderBottom: "1px solid var(--rule)" }}>
              {table.columns.map((c, i) => (
                <th key={i} style={{ padding: "6px 10px", fontWeight: 600, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  borderBottom: ri < table.rows.length - 1 ? "1px solid var(--rule)" : "none",
                  background: ri % 2 === 1 ? "var(--paper-sunk)" : "var(--sheet)",
                }}
              >
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding: "6px 10px", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenderDiagnosticTree({ diagnostic }: { diagnostic: any }) {
  const isDecline = diagnostic.direction === "decline";
  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: "12px 14px",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        background: "var(--sheet)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
          <Network size={14} color="var(--tick-deep)" />
          Virtual CFO Diagnostic Tree: {diagnostic.root_metric}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "'IBM Plex Mono', monospace",
            padding: "2px 7px",
            borderRadius: 3,
            background: isDecline ? "var(--redink-wash, #fbece9)" : "var(--tick-wash, #e8f3ed)",
            color: isDecline ? "var(--redink, #b42318)" : "var(--tick-deep, #13654a)",
            border: `1px solid ${isDecline ? "var(--redink-soft, rgba(180, 35, 24, 0.25))" : "var(--tick, #1a7f55)"}`,
          }}
        >
          {diagnostic.direction?.toUpperCase() || "CHANGE"}
        </span>
      </div>

      {diagnostic.summary && (
        <p style={{ fontSize: 11, color: "var(--ink-2)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
          {diagnostic.summary}
        </p>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        {(diagnostic.drivers || []).map((d: any, idx: number) => {
          const weight = Math.round((d.weight || 0.5) * 100);
          return (
            <div
              key={idx}
              style={{
                padding: "8px 10px",
                borderRadius: 4,
                background: "var(--paper-sunk)",
                border: "1px solid var(--rule)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)" }}>{d.name}</span>
                <span style={{ fontSize: 10, color: "var(--graphite)", fontFamily: "'IBM Plex Mono', monospace" }}>
                  Weight: {weight}% | Impact: <strong>{d.impact}</strong>
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: "var(--rule)", overflow: "hidden", marginBottom: 6 }}>
                <div style={{ height: "100%", width: `${weight}%`, background: "var(--tick)" }} />
              </div>
              {d.recommendation && (
                <p style={{ margin: 0, fontSize: 10, color: "var(--graphite)", fontStyle: "italic" }}>
                  💡 {d.recommendation}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RenderAgentTrace({ agent }: { agent: any }) {
  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: "12px 14px",
        border: "1px solid var(--rule)",
        borderRadius: 6,
        background: "var(--sheet)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
          <span>{agent.icon}</span> {agent.label} ({agent.agent_name})
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            fontFamily: "'IBM Plex Mono', monospace",
            padding: "2px 6px",
            borderRadius: 3,
            background: "var(--paper-sunk)",
            color: "var(--tick-deep)",
            border: "1px solid var(--rule)",
          }}
        >
          {agent.stage?.toUpperCase()}
        </span>
      </div>

      <p style={{ fontSize: 11, color: "var(--ink-2)", margin: "0 0 8px 0" }}>{agent.description}</p>

      {agent.findings && agent.findings.length > 0 && (
        <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
          <strong style={{ fontSize: 10, color: "var(--graphite)" }}>FLAGGED FINDINGS ({agent.findings.length}):</strong>
          {agent.findings.map((f: any, i: number) => (
            <div key={i} style={{ padding: "6px 8px", borderRadius: 4, background: "var(--paper-sunk)", border: "1px solid var(--rule)" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)" }}>[{f.severity?.toUpperCase()}] {f.title}</span>
              <p style={{ margin: "2px 0 0 0", fontSize: 10, color: "var(--graphite)" }}>{f.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RenderMemoryCard({ memory }: { memory: any }) {
  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 10,
        padding: "12px 14px",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        background: "var(--sheet)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
          <Brain size={13} color="var(--tick-deep)" /> Strategic Memory: {memory.company}
        </span>
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {(memory.observations || []).map((o: any, i: number) => (
          <div key={i} style={{ padding: "6px 8px", borderRadius: 4, background: "var(--paper-sunk)", border: "1px solid var(--rule)", fontSize: 11 }}>
            {o.content}
          </div>
        ))}
      </div>
    </div>
  );
}

function InstructionStatus({ ins }: { ins: Instruction | undefined }) {
  if (!ins) return null;
  if (ins.status === "pending") return <div className="ins-status">Waiting for the next stage</div>;
  if (ins.status === "applied") {
    const who = (ins.target_agents ?? []).map((a) => agentDef(a).label).join(", ");
    return <div className="ins-status ins-applied">Applied{who ? ` to ${who}` : ""}{ins.orchestrator_note ? `. ${ins.orchestrator_note}` : ""}</div>;
  }
  return <div className="ins-status">Not applied{ins.orchestrator_note ? `: ${ins.orchestrator_note}` : ""}</div>;
}
