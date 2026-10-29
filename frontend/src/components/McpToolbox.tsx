import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2, Terminal, Server, Wrench, CheckCircle2, AlertCircle, Play, Globe, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import type { MCPEndpoint, MCPTool } from "../lib/types";
import { useFeedback } from "./feedback";
import { Spinner } from "./ui";

export function McpToolboxView() {
  const qc = useQueryClient();
  const { toast } = useFeedback();

  const [selectedToolset, setSelectedToolset] = useState<string>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAuth, setNewAuth] = useState("");
  const [newTransport, setNewTransport] = useState("sse");

  // Tool testing state
  const [testingTool, setTestingTool] = useState<MCPTool | null>(null);
  const [testArgsJson, setTestArgsJson] = useState("{}");
  const [testResult, setTestResult] = useState<any>(null);
  const [isCallingTool, setIsCallingTool] = useState(false);

  // Tavily MCP key management state
  const [tavilyApiKeyInput, setTavilyApiKeyInput] = useState("");
  const [isUpdatingTavily, setIsUpdatingTavily] = useState(false);

  // Queries
  const { data: endpointsData, isLoading: loadingEndpoints } = useQuery({
    queryKey: ["mcp", "endpoints"],
    queryFn: () => api.listMcpEndpoints(),
  });

  const { data: toolsData, isLoading: loadingTools } = useQuery({
    queryKey: ["mcp", "tools", selectedToolset],
    queryFn: () => api.listMcpTools(selectedToolset === "all" ? undefined : selectedToolset),
  });

  // Mutations
  const addEndpointMutation = useMutation({
    mutationFn: () =>
      api.addMcpEndpoint({
        name: newName.trim(),
        endpoint_url: newUrl.trim(),
        transport: newTransport,
        auth_token: newAuth.trim() || undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["mcp"] });
      setShowAddModal(false);
      setNewName("");
      setNewUrl("");
      setNewAuth("");
      toast(`Endpoint added! Discovered ${res.sync?.tool_count ?? 0} tools.`, "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.syncMcpEndpoint(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["mcp"] });
      toast(`Synced tools: ${data.tool_count ?? 0} tools active.`, "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteMcpEndpoint(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp"] });
      toast("Endpoint removed.", "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const handleRunToolTest = async () => {
    if (!testingTool) return;
    setIsCallingTool(true);
    setTestResult(null);
    try {
      let args = {};
      try {
        args = JSON.parse(testArgsJson);
      } catch {
        toast("Arguments must be valid JSON.", "error");
        setIsCallingTool(false);
        return;
      }
      const res = await api.callMcpTool(testingTool.name, args);
      setTestResult(res);
      if (res.success) {
        toast(`Executed in ${res.execution_time_ms}ms`, "success");
      } else {
        toast(res.error || "Execution failed", "error");
      }
    } catch (err: any) {
      toast(err.message || "Failed to call tool", "error");
      setTestResult({ success: false, error: err.message });
    } finally {
      setIsCallingTool(false);
    }
  };

  const endpoints: MCPEndpoint[] = endpointsData?.endpoints || [];
  const tools: MCPTool[] = toolsData?.tools || [];
  const toolsets: string[] = toolsData?.toolsets || [];

  const handleUpdateTavily = async () => {
    if (!tavilyApiKeyInput.trim()) {
      toast("Please enter a valid Tavily API Key", "error");
      return;
    }
    setIsUpdatingTavily(true);
    try {
      const res = await api.updateTavilyKey(tavilyApiKeyInput.trim());
      qc.invalidateQueries({ queryKey: ["mcp"] });
      toast(res.message || "Tavily MCP Key saved & synchronized!", "success");
      setTavilyApiKeyInput("");
    } catch (err: any) {
      toast(err.message || "Failed to update Tavily MCP key", "error");
    } finally {
      setIsUpdatingTavily(false);
    }
  };

  const tavilyEndpoint = endpoints.find(
    (e) => e.name.toLowerCase().includes("tavily") || e.endpoint_url.toLowerCase().includes("tavily")
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {/* Header & Description */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--ink, #16212e)" }}>
            <Wrench size={20} color="var(--tick, #1a7f55)" />
            MCP Toolset Box &amp; Remote Endpoints
          </h2>
          <p style={{ margin: 0, color: "var(--ink-2, #4a5563)", fontSize: "0.875rem" }}>
            Modular Model Context Protocol (FastMCP) ecosystem. Native deterministic &amp; SQLite memory tools plus dynamic external MCP endpoints.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.45rem",
            padding: "0.45rem 1rem",
            borderRadius: "4px",
            backgroundColor: "var(--tick, #1a7f55)",
            color: "#ffffff",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
            fontSize: "0.85rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <Plus size={15} /> Add MCP Endpoint
        </button>
      </div>

      {/* Tavily MCP Value Validation Feature Card */}
      <div
        style={{
          border: "1px solid rgba(2, 132, 199, 0.25)",
          borderRadius: "8px",
          padding: "1.25rem",
          backgroundColor: "rgba(240, 249, 255, 0.65)",
          display: "flex",
          flexDirection: "column",
          gap: "0.85rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Globe size={18} color="#0284c7" />
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#0369a1" }}>
                Tavily MCP Web Intelligence &amp; Value Validation
              </h3>
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  backgroundColor: tavilyEndpoint?.status === "active" ? "var(--tick-wash, #e8f3ed)" : "var(--redink-wash, #fbece9)",
                  color: tavilyEndpoint?.status === "active" ? "var(--tick-deep, #13654a)" : "var(--redink, #b42318)",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.2rem",
                }}
              >
                {tavilyEndpoint?.status === "active" ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {tavilyEndpoint?.status ? tavilyEndpoint.status.toUpperCase() : "CONFIGURED"}
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  backgroundColor: "#e0f2fe",
                  color: "#0369a1",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.2rem",
                }}
              >
                <Sparkles size={11} /> VISIBLE ON 3D GRAPH
              </span>
            </div>
            <p style={{ margin: "0.35rem 0 0 0", color: "#334155", fontSize: "0.825rem", lineHeight: 1.45 }}>
              Cross-validates stated figures, ratios, and marginal profits against live public Internet data, SEC/MCA filings, and market consensus. Powered by the remote Model Context Protocol (FastMCP SSE) endpoint.
            </p>
          </div>
          {tavilyEndpoint && (
            <button
              onClick={() => syncMutation.mutate(tavilyEndpoint.id)}
              disabled={syncMutation.isPending}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "4px",
                border: "1px solid rgba(2, 132, 199, 0.4)",
                backgroundColor: "#ffffff",
                color: "#0369a1",
                fontSize: "0.8rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={13} className={syncMutation.isPending ? "spin" : ""} />
              Sync Tavily Tools ({tavilyEndpoint.tool_count})
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.25rem" }}>
          <div style={{ flex: "1 1 340px", display: "flex", gap: "0.5rem" }}>
            <input
              type="password"
              placeholder="Update Tavily API Key (or loaded from .env: tvly-dev-...)"
              value={tavilyApiKeyInput}
              onChange={(e) => setTavilyApiKeyInput(e.target.value)}
              style={{
                flex: 1,
                padding: "0.4rem 0.65rem",
                fontSize: "0.825rem",
                borderRadius: "4px",
                border: "1px solid #94a3b8",
                fontFamily: "'IBM Plex Mono', monospace",
                backgroundColor: "#ffffff",
              }}
            />
            <button
              onClick={handleUpdateTavily}
              disabled={isUpdatingTavily || !tavilyApiKeyInput.trim()}
              style={{
                padding: "0.4rem 0.85rem",
                fontSize: "0.825rem",
                fontWeight: 500,
                backgroundColor: "#0284c7",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                cursor: tavilyApiKeyInput.trim() ? "pointer" : "not-allowed",
                opacity: tavilyApiKeyInput.trim() ? 1 : 0.6,
              }}
            >
              {isUpdatingTavily ? "Saving..." : "Save Key & Sync"}
            </button>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>
            Endpoint: <code style={{ backgroundColor: "#e2e8f0", padding: "0.15rem 0.35rem", borderRadius: "3px" }}>https://mcp.tavily.com/mcp/?tavilyApiKey=...</code>
          </div>
        </div>
      </div>

      {/* Connected Endpoints Section */}
      <div>
        <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--ink, #16212e)" }}>
          <Server size={17} /> Active Endpoints ({endpoints.length})
        </h3>
        {loadingEndpoints ? (
          <Spinner />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
            {endpoints.map((ep) => (
              <div
                key={ep.id}
                style={{
                  border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
                  borderRadius: "6px",
                  padding: "1rem",
                  backgroundColor: "var(--sheet, #ffffff)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--ink, #16212e)" }}>{ep.name}</div>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "999px",
                        backgroundColor: ep.status === "active" ? "var(--tick-wash, #e8f3ed)" : "var(--redink-wash, #fbece9)",
                        color: ep.status === "active" ? "var(--tick-deep, #13654a)" : "var(--redink, #b42318)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        fontWeight: 600,
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      {ep.status === "active" ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                      {ep.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ink-2, #4a5563)", marginTop: "0.35rem", wordBreak: "break-all", fontFamily: "'IBM Plex Mono', monospace" }}>
                    {ep.endpoint_url}
                  </div>
                  {ep.status_message && (
                    <div style={{ fontSize: "0.75rem", color: "var(--graphite, #7a838f)", marginTop: "0.25rem" }}>
                      {ep.status_message}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--rule, rgba(22, 33, 46, 0.1))", paddingTop: "0.6rem", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--ink-2, #4a5563)", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem" }}>
                    {ep.tool_count} {ep.tool_count === 1 ? "tool" : "tools"} exposed
                  </span>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      onClick={() => syncMutation.mutate(ep.id)}
                      disabled={syncMutation.isPending}
                      title="Sync tools"
                      style={{
                        background: "var(--paper-sunk, #eef0ec)",
                        border: "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
                        color: "var(--ink, #16212e)",
                        borderRadius: "4px",
                        padding: "0.25rem 0.55rem",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        fontSize: "0.75rem",
                        fontFamily: "inherit",
                      }}
                    >
                      <RefreshCw size={11} /> Sync
                    </button>
                    {ep.id !== "internal" && (
                      <button
                        onClick={() => {
                          if (confirm(`Remove MCP endpoint "${ep.name}"?`)) {
                            deleteMutation.mutate(ep.id);
                          }
                        }}
                        title="Remove endpoint"
                        style={{
                          background: "none",
                          border: "1px solid rgba(220, 38, 38, 0.3)",
                          color: "#dc2626",
                          borderRadius: "4px",
                          padding: "0.25rem 0.5rem",
                          cursor: "pointer",
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discovered Tools Catalog */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--ink, #16212e)" }}>
            <Terminal size={17} /> FastMCP Tools Catalog ({tools.length})
          </h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)" }}>Filter toolset:</span>
            <select
              value={selectedToolset}
              onChange={(e) => setSelectedToolset(e.target.value)}
              style={{
                backgroundColor: "var(--sheet, #ffffff)",
                border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                color: "var(--ink, #16212e)",
                padding: "0.25rem 0.6rem",
                borderRadius: "4px",
                fontSize: "0.8rem",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              <option value="all">All Toolsets ({tools.length})</option>
              {toolsets.map((ts) => (
                <option key={ts} value={ts}>{ts.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>

        {loadingTools ? (
          <Spinner />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "0.75rem" }}>
            {tools.map((t) => (
              <div
                key={t.name}
                style={{
                  border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
                  borderRadius: "6px",
                  padding: "0.85rem",
                  backgroundColor: "var(--sheet, #ffffff)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                    <code style={{ fontSize: "0.825rem", color: "var(--ink, #16212e)", fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                      {t.name}
                    </code>
                    <span
                      style={{
                        fontSize: "0.68rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "3px",
                        backgroundColor: "var(--paper-sunk, #eef0ec)",
                        color: "var(--ink-2, #4a5563)",
                        border: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      {t.toolset}
                    </span>
                  </div>
                  <p style={{ margin: "0.35rem 0 0 0", fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", lineHeight: 1.4 }}>
                    {t.description || "No description provided."}
                  </p>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--rule, rgba(22, 33, 46, 0.08))", paddingTop: "0.45rem" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--graphite, #7a838f)", fontFamily: "'IBM Plex Mono', monospace" }}>
                    {t.endpoint_name || (t.endpoint_id === "internal" ? "Native FastMCP" : t.endpoint_id)}
                  </span>
                  <button
                    onClick={() => {
                      setTestingTool(t);
                      setTestArgsJson(JSON.stringify(t.parameters?.properties ? Object.fromEntries(Object.keys(t.parameters.properties).map(k => [k, ""])) : {}, null, 2));
                      setTestResult(null);
                    }}
                    style={{
                      background: "var(--tick-wash, #e8f3ed)",
                      border: "1px solid var(--tick, #1a7f55)",
                      color: "var(--tick-deep, #13654a)",
                      borderRadius: "4px",
                      padding: "0.2rem 0.55rem",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      fontFamily: "inherit",
                    }}
                  >
                    <Play size={10} /> Test Tool
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Endpoint Modal */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(22, 33, 46, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--sheet, #ffffff)",
              border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
              borderRadius: "8px",
              padding: "1.5rem",
              width: "100%",
              maxWidth: "520px",
              boxShadow: "var(--lift)",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600, color: "var(--ink, #16212e)" }}>
                Add Remote MCP Endpoint
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ background: "none", border: "none", color: "var(--graphite, #7a838f)", cursor: "pointer", fontSize: "1.25rem" }}
              >
                &times;
              </button>
            </div>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-2, #4a5563)" }}>
              Connect an external Model Context Protocol server over HTTP or SSE to automatically discover its tools.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Endpoint Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. SEC Filings MCP or Company Data Server"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "4px",
                    border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                    backgroundColor: "var(--sheet, #ffffff)",
                    color: "var(--ink, #16212e)",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Endpoint URL
                </label>
                <input
                  type="text"
                  placeholder="http://localhost:8000/sse or https://.../mcp"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "4px",
                    border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                    backgroundColor: "var(--sheet, #ffffff)",
                    color: "var(--ink, #16212e)",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.85rem",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Transport
                  </label>
                  <select
                    value={newTransport}
                    onChange={(e) => setNewTransport(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      borderRadius: "4px",
                      border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                      backgroundColor: "var(--sheet, #ffffff)",
                      color: "var(--ink, #16212e)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <option value="sse">SSE (Server-Sent Events)</option>
                    <option value="http">HTTP POST (JSON-RPC)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Auth Token (Optional)
                  </label>
                  <input
                    type="password"
                    placeholder="Bearer token"
                    value={newAuth}
                    onChange={(e) => setNewAuth(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      borderRadius: "4px",
                      border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                      backgroundColor: "var(--sheet, #ffffff)",
                      color: "var(--ink, #16212e)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{
                  padding: "0.45rem 0.9rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  background: "none",
                  color: "var(--ink-2, #4a5563)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => addEndpointMutation.mutate()}
                disabled={!newName.trim() || !newUrl.trim() || addEndpointMutation.isPending}
                style={{
                  padding: "0.45rem 1rem",
                  borderRadius: "4px",
                  border: "none",
                  backgroundColor: "var(--tick, #1a7f55)",
                  color: "#ffffff",
                  fontWeight: 500,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                {addEndpointMutation.isPending ? "Connecting & Syncing..." : "Connect & Discover"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Tool Modal */}
      {testingTool && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(22, 33, 46, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--sheet, #ffffff)",
              border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
              borderRadius: "8px",
              padding: "1.5rem",
              width: "100%",
              maxWidth: "540px",
              boxShadow: "var(--lift)",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--ink, #16212e)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Play size={16} color="var(--tick, #1a7f55)" /> Test FastMCP Tool: {testingTool.name}
              </h3>
              <button
                onClick={() => setTestingTool(null)}
                style={{ background: "none", border: "none", color: "var(--graphite, #7a838f)", cursor: "pointer", fontSize: "1.25rem" }}
              >
                &times;
              </button>
            </div>
            <p style={{ margin: 0, fontSize: "0.825rem", color: "var(--ink-2, #4a5563)" }}>{testingTool.description}</p>

            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                Arguments (JSON format)
              </label>
              <textarea
                rows={5}
                value={testArgsJson}
                onChange={(e) => setTestArgsJson(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  backgroundColor: "var(--paper-sunk, #eef0ec)",
                  color: "var(--ink, #16212e)",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.825rem",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleRunToolTest}
                disabled={isCallingTool}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.45rem 1rem",
                  borderRadius: "4px",
                  border: "none",
                  backgroundColor: "var(--tick, #1a7f55)",
                  color: "#ffffff",
                  fontWeight: 500,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                {isCallingTool ? <><Spinner size={12} /> Executing Tool…</> : <><Play size={12} /> Execute Tool</>}
              </button>
            </div>

            {testResult && (
              <div
                style={{
                  backgroundColor: testResult.success ? "var(--tick-wash, #e8f3ed)" : "var(--redink-wash, #fbece9)",
                  padding: "0.85rem",
                  borderRadius: "4px",
                  border: `1px solid ${testResult.success ? "var(--tick, #1a7f55)" : "var(--redink, #b42318)"}`,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.8rem", color: testResult.success ? "var(--tick-deep, #13654a)" : "var(--redink, #b42318)" }}>
                  {testResult.success ? `Success (${testResult.execution_time_ms}ms)` : "Execution Error"}
                </div>
                <pre
                  style={{
                    margin: "0.35rem 0 0 0",
                    fontSize: "0.775rem",
                    color: "var(--ink, #16212e)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    maxHeight: "180px",
                    overflowY: "auto",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {typeof testResult.content === "object"
                    ? JSON.stringify(testResult.content, null, 2)
                    : String(testResult.content || testResult.error)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
