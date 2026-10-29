import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, Trash2, Edit3, Play, Check, Wrench } from "lucide-react";
import { api } from "../lib/api";
import type { AgentDefinition, SkillDefinition, MCPTool } from "../lib/types";
import { useFeedback } from "./feedback";
import { Spinner } from "./ui";

export function AgentStudioView() {
  const qc = useQueryClient();
  const { toast } = useFeedback();

  const [filterType, setFilterType] = useState<"all" | "custom" | "builtin">("all");
  const [showModal, setShowModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [modelTier, setModelTier] = useState<string>("default");

  // Playground state
  const [testingAgent, setTestingAgent] = useState<AgentDefinition | null>(null);
  const [testInput, setTestInput] = useState("Assess the current ratio and debt-to-equity leverage for the latest period.");
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Queries
  const { data: agentsData, isLoading: loadingAgents } = useQuery({
    queryKey: ["agents", "full"],
    queryFn: () => api.listAgentsFull(),
  });

  const { data: skills = [] } = useQuery({
    queryKey: ["agents", "skills"],
    queryFn: () => api.listSkills(),
  });

  const { data: toolsData } = useQuery({
    queryKey: ["mcp", "tools"],
    queryFn: () => api.listMcpTools(),
  });

  const availableTools: MCPTool[] = toolsData?.tools || [];

  // Mutations
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        role: role.trim(),
        description: description.trim(),
        system_prompt: systemPrompt.trim(),
        skills: selectedSkills,
        assigned_tools: selectedTools,
        model_tier: modelTier,
      };
      if (editingAgent) {
        return api.updateCustomAgent(editingAgent.id, payload);
      }
      return api.createCustomAgent(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      setShowModal(false);
      resetForm();
      toast(editingAgent ? "Agent updated." : "New agent created successfully!", "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCustomAgent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast("Agent deleted.", "success");
    },
    onError: (err: Error) => toast(err.message, "error"),
  });

  const resetForm = () => {
    setEditingAgent(null);
    setName("");
    setRole("");
    setDescription("");
    setSystemPrompt("");
    setSelectedSkills([]);
    setSelectedTools([]);
    setModelTier("default");
  };

  const handleEdit = (agent: AgentDefinition) => {
    setEditingAgent(agent);
    setName(agent.name);
    setRole(agent.role);
    setDescription(agent.description || "");
    setSystemPrompt(agent.system_prompt || "");
    setSelectedSkills(agent.skills || []);
    setSelectedTools(agent.assigned_tools || []);
    setModelTier(agent.model_tier || "default");
    setShowModal(true);
  };

  const handleRunPlayground = async () => {
    if (!testingAgent) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testCustomAgent(testingAgent.id, {
        input: testInput,
        system_prompt: testingAgent.system_prompt,
      });
      setTestResult(res);
      toast(`Execution finished in ${res.duration_ms}ms`, "success");
    } catch (err: any) {
      toast(err.message || "Failed to test agent", "error");
      setTestResult({ response: `Error: ${err.message}` });
    } finally {
      setIsTesting(false);
    }
  };

  const customAgents: AgentDefinition[] = agentsData?.custom || [];
  const builtinAgents: AgentDefinition[] = agentsData?.builtin || [];

  let displayedAgents: AgentDefinition[] = [];
  if (filterType === "all") displayedAgents = [...builtinAgents, ...customAgents];
  else if (filterType === "custom") displayedAgents = customAgents;
  else displayedAgents = builtinAgents;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--ink, #16212e)" }}>
            <Bot size={20} color="var(--tick, #1a7f55)" />
            Agent Studio &amp; Custom Skills
          </h2>
          <p style={{ margin: 0, color: "var(--ink-2, #4a5563)", fontSize: "0.875rem" }}>
            Design and orchestrate multi-agent personas. Define custom system prompts, assign specialized financial skills, and equip agents with FastMCP tools.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
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
          <Plus size={15} /> Create Custom Agent
        </button>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "inline-flex", gap: "0.35rem", padding: "0.25rem", backgroundColor: "var(--paper-sunk, #eef0ec)", borderRadius: "6px", width: "fit-content" }}>
        {(["all", "custom", "builtin"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterType(tab)}
            style={{
              background: filterType === tab ? "var(--sheet, #ffffff)" : "none",
              color: filterType === tab ? "var(--ink, #16212e)" : "var(--graphite, #7a838f)",
              boxShadow: filterType === tab ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              border: "none",
              padding: "0.35rem 0.85rem",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.825rem",
              fontWeight: 500,
              fontFamily: "inherit",
              textTransform: "capitalize",
            }}
          >
            {tab === "all" ? `All Agents (${customAgents.length + builtinAgents.length})` : tab === "custom" ? `Custom Personas (${customAgents.length})` : `System Pipeline (${builtinAgents.length})`}
          </button>
        ))}
      </div>

      {/* Agent Grid */}
      {loadingAgents ? (
        <Spinner />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1rem" }}>
          {displayedAgents.map((agent) => (
            <div
              key={agent.id}
              style={{
                border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
                borderRadius: "6px",
                padding: "1.25rem",
                backgroundColor: "var(--sheet, #ffffff)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "1rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--ink, #16212e)" }}>{agent.name}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--tick-deep, #13654a)", marginTop: "0.15rem", fontWeight: 500 }}>{agent.role}</div>
                  </div>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "999px",
                      backgroundColor: agent.is_builtin ? "var(--paper-sunk, #eef0ec)" : "var(--tick-wash, #e8f3ed)",
                      color: agent.is_builtin ? "var(--graphite, #7a838f)" : "var(--tick-deep, #13654a)",
                      fontWeight: 600,
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    {agent.is_builtin ? "SYSTEM" : "CUSTOM"}
                  </span>
                </div>

                <p style={{ margin: "0.6rem 0", fontSize: "0.825rem", color: "var(--ink-2, #4a5563)", lineHeight: 1.45 }}>
                  {agent.description || "Specialized financial analysis agent."}
                </p>

                {/* Skills tags */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", margin: "0.5rem 0" }}>
                  {(agent.skills || []).map((sk) => (
                    <span
                      key={sk}
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.15rem 0.45rem",
                        borderRadius: "3px",
                        backgroundColor: "var(--paper-sunk, #eef0ec)",
                        color: "var(--ink-2, #4a5563)",
                        border: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}
                    >
                      {sk.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>

                {/* Assigned tools summary */}
                <div style={{ fontSize: "0.75rem", color: "var(--graphite, #7a838f)", marginTop: "0.35rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <Wrench size={12} />
                  <span>{(agent.assigned_tools || []).length} FastMCP tools bound</span>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--rule, rgba(22, 33, 46, 0.1))", paddingTop: "0.75rem" }}>
                <button
                  onClick={() => {
                    setTestingAgent(agent);
                    setTestResult(null);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    background: "var(--tick-wash, #e8f3ed)",
                    border: "1px solid var(--tick, #1a7f55)",
                    color: "var(--tick-deep, #13654a)",
                    padding: "0.3rem 0.65rem",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    fontFamily: "inherit",
                  }}
                >
                  <Play size={11} /> Test Playground
                </button>

                {!agent.is_builtin && (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      onClick={() => handleEdit(agent)}
                      style={{
                        background: "none",
                        border: "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
                        color: "var(--ink-2, #4a5563)",
                        padding: "0.3rem 0.6rem",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.25rem",
                      }}
                    >
                      <Edit3 size={11} /> Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete custom agent "${agent.name}"?`)) {
                          deleteMutation.mutate(agent.id);
                        }
                      }}
                      style={{
                        background: "none",
                        border: "1px solid rgba(220, 38, 38, 0.3)",
                        color: "#dc2626",
                        padding: "0.3rem 0.5rem",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
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
              maxWidth: "600px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "var(--lift, 0 8px 24px -8px rgba(22, 33, 46, 0.18))",
              display: "flex",
              flexDirection: "column",
              gap: "1.1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600, color: "var(--ink, #16212e)" }}>
                {editingAgent ? `Edit Agent: ${editingAgent.name}` : "Create New Custom Agent"}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: "none", border: "none", color: "var(--graphite, #7a838f)", cursor: "pointer", fontSize: "1.25rem" }}
              >
                &times;
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Agent Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Tax & Provision Auditor"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
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
                    Role Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Corporate Tax Specialist"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
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

              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Short summary of this agent's responsibilities"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", fontWeight: 500 }}>System Prompt</label>
                  <span style={{ fontSize: "0.7rem", color: "var(--graphite, #7a838f)" }}>Guides reasoning &amp; persona</span>
                </div>
                <textarea
                  rows={5}
                  placeholder="You are an expert financial agent. Analyze..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "4px",
                    border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                    backgroundColor: "var(--sheet, #ffffff)",
                    color: "var(--ink, #16212e)",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.825rem",
                  }}
                />
              </div>

              {/* Skills Selector */}
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.35rem", fontWeight: 500 }}>
                  Assign Skills ({selectedSkills.length} selected)
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", maxHeight: "110px", overflowY: "auto", padding: "0.35rem", backgroundColor: "var(--paper-sunk, #eef0ec)", borderRadius: "4px" }}>
                  {skills.map((sk: SkillDefinition) => {
                    const isSelected = selectedSkills.includes(sk.name);
                    return (
                      <button
                        key={sk.name}
                        type="button"
                        onClick={() => {
                          setSelectedSkills(isSelected ? selectedSkills.filter(s => s !== sk.name) : [...selectedSkills, sk.name]);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "3px",
                          fontSize: "0.75rem",
                          border: isSelected ? "1px solid var(--tick, #1a7f55)" : "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
                          backgroundColor: isSelected ? "var(--tick-wash, #e8f3ed)" : "var(--sheet, #ffffff)",
                          color: isSelected ? "var(--tick-deep, #13654a)" : "var(--ink, #16212e)",
                          cursor: "pointer",
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}
                      >
                        {isSelected && <Check size={11} />}
                        {sk.name.replace(/_/g, " ")}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* MCP Tools Selector */}
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.35rem", fontWeight: 500 }}>
                  Assign FastMCP Tools ({selectedTools.length} selected)
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", maxHeight: "120px", overflowY: "auto", padding: "0.35rem", backgroundColor: "var(--paper-sunk, #eef0ec)", borderRadius: "4px" }}>
                  {availableTools.map((t) => {
                    const isSelected = selectedTools.includes(t.name);
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => {
                          setSelectedTools(isSelected ? selectedTools.filter(tool => tool !== t.name) : [...selectedTools, t.name]);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "3px",
                          fontSize: "0.75rem",
                          border: isSelected ? "1px solid var(--tick, #1a7f55)" : "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
                          backgroundColor: isSelected ? "var(--tick-wash, #e8f3ed)" : "var(--sheet, #ffffff)",
                          color: isSelected ? "var(--tick-deep, #13654a)" : "var(--ink, #16212e)",
                          cursor: "pointer",
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}
                      >
                        {isSelected && <Check size={11} />}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  padding: "0.45rem 0.9rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  backgroundColor: "transparent",
                  color: "var(--ink-2, #4a5563)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={!name.trim() || !role.trim() || saveMutation.isPending}
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
                {saveMutation.isPending ? "Saving..." : editingAgent ? "Save Changes" : "Create Agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Playground Modal */}
      {testingAgent && (
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
              maxWidth: "560px",
              boxShadow: "var(--lift)",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "var(--ink, #16212e)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Play size={16} color="var(--tick, #1a7f55)" /> Test Agent: {testingAgent.name}
              </h3>
              <button
                onClick={() => setTestingAgent(null)}
                style={{ background: "none", border: "none", color: "var(--graphite, #7a838f)", cursor: "pointer", fontSize: "1.25rem" }}
              >
                &times;
              </button>
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", color: "var(--ink-2, #4a5563)", display: "block", marginBottom: "0.3rem", fontWeight: 500 }}>
                Test Input Prompt
              </label>
              <textarea
                rows={3}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "4px",
                  border: "1px solid var(--rule-strong, rgba(22, 33, 46, 0.2))",
                  backgroundColor: "var(--paper-sunk, #eef0ec)",
                  color: "var(--ink, #16212e)",
                  fontSize: "0.85rem",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleRunPlayground}
                disabled={isTesting}
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
                {isTesting ? <><Spinner size={12} /> Running Analysis…</> : <><Play size={12} /> Run Test</>}
              </button>
            </div>

            {testResult && (
              <div
                style={{
                  padding: "0.85rem",
                  borderRadius: "4px",
                  backgroundColor: "var(--paper-sunk, #eef0ec)",
                  border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
                  fontSize: "0.85rem",
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--ink, #16212e)", marginBottom: "0.35rem", display: "flex", justifyContent: "space-between" }}>
                  <span>Agent Output</span>
                  {testResult.duration_ms && (
                    <span style={{ fontSize: "0.75rem", fontFamily: "'IBM Plex Mono', monospace", color: "var(--graphite, #7a838f)" }}>
                      {testResult.duration_ms}ms
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--ink-2, #4a5563)", lineHeight: 1.45, whiteSpace: "pre-wrap", fontSize: "0.825rem" }}>
                  {testResult.response}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
