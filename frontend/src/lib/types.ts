export type JobStatus =
  | "CREATED" | "INGESTING" | "MAPPING" | "RECONCILING" | "AWAITING_REVIEW" | "DATA_VALIDATED"
  | "ANALYZING" | "PARTIAL" | "SYNTHESIZING" | "VERIFYING" | "NEEDS_ANALYST" | "RENDERING"
  | "COMPLETED" | "FAILED";

export interface Job {
  id: string;
  stage: string;
  status: JobStatus;
  progress_pct: number;
  progress_message: string;
  dataset_version_id: string | null;
  error: string | null;
  updated_at: string;
  created_at: string | null;
  goal: string;
  plan_template: string;
  company_name: string | null;
  industry: string | null;
  dataset_versions?: number;
  run_started_at?: string | null;
  document_count?: number;
  documents?: JobDocument[];
}

export interface JobDocument {
  id: string;
  filename: string;
  doc_type: string | null;
  status: string;
  period_end: string | null;
}

export interface TaskRun {
  id: string;
  agent: string;
  status: "done" | "partial" | "failed" | "needs_review" | string;
  summary: string | null;
  confidence: number | null;
  issues: { severity?: string; code?: string; message?: string }[] | null;
  created_at: string;
}

export interface Metric {
  id: string;
  metric_code: string;
  period_end: string;
  value: number | null;
  unit: string;
}

export interface Finding {
  id: string;
  module: string;
  severity: "info" | "warn" | "error" | string;
  title: string;
  body: string | null;
  metric_ids: string[] | null;
  confidence: number | null;
}

export interface Chart {
  chart_id: string;
  title: string;
  caption: string;
  png_base64: string;
  /** One-line computed "so what" printed under the chart title (deterministic, not the model). */
  takeaway?: string;
  section_key?: string | null;
}

export interface ValidationCheck {
  check_code: string;
  status: string;
  expected: number | null;
  actual: number | null;
  diff: number | null;
  details: unknown;
}

export interface HealthScore {
  score: number;
  rating: string;
  breakdown: { metric_code: string; points: number; weight: number; included: boolean }[];
}

export interface ReviewRecommendation {
  item_id?: string;
  kind?: string;
  action?: "accept" | "remap" | "adjust" | string;
  suggested_account_id?: string;
  account_name?: string;
  confidence?: number;
  reasoning?: string;
  audit_note?: string;
  title?: string;
  auto_resolvable?: boolean;
  alternatives?: { account_id: string; account_name?: string; confidence?: number }[];
}

export interface ReviewItem {
  id: string;
  kind: "reconciliation" | "mapping" | "verification" | string;
  status: string;
  created_at: string;
  payload: {
    check_code?: string;
    expected?: number;
    actual?: number;
    diff?: number;
    explanation?: string;
    label?: string;
    section?: string;
    suggested_account_id?: string;
    confidence?: number;
    document_id?: string;
    summary?: string;
    issues?: string[];
    feedback?: string[];

    recommendation?: ReviewRecommendation;
    [k: string]: unknown;
  };
}


export interface Instruction {
  id: string;
  content: string;
  status: "pending" | "applied" | "ignored" | string;
  stage_applied: string | null;
  target_agents: string[] | null;
  orchestrator_note: string | null;
  created_at: string;
  applied_at: string | null;
}

export interface LlmStatus {
  configured_backend: string;
  resolved_backend: string;
  active_model: string;
  reasoning_model?: string | null;
  parallel_calls: boolean;
  max_concurrent_requests: number;
  keys_configured: { nvidia: boolean; custom: boolean; openai?: boolean; gemini?: boolean };
  masked_keys: { nvidia: string; custom: string; openai?: string; gemini?: string };
  models?: Record<string, string>;
  nvidia_base_url?: string;
  custom_base_url?: string;
  temperature?: number;
  persona_preset?: string;
  custom_system_prompt?: string;
  history_turns?: number;
  fallback_cascade?: boolean;
  show_telemetry?: boolean;
  timeout_s?: number;
  max_tokens?: number;
}

export type AssistantResponse =
  | { type: "clarification"; question: string; options: { label: string; description: string; agent: string }[] }
  | {
      type: "answer";
      answer: string;
      agent_used: string | null;
      status?: string;
      report_updated?: boolean;
      chart?: Chart | null;
      tool_used?: string;
    };

export interface RenderedTable {
  columns: string[];
  rows: (string | number)[][];
  summary?: string;
}

export interface RenderedDiagnosticDriver {
  name: string;
  weight: number;
  impact: string;
  recommendation?: string;
}

export interface RenderedDiagnostic {
  root_metric: string;
  metric_id: string | number;
  direction: string;
  summary: string;
  drivers: RenderedDiagnosticDriver[];
}

export interface RenderedAgent {
  agent_name: string;
  label: string;
  icon: string;
  stage: string;
  description: string;
  steerable: boolean;
  rerunnable: boolean;
  status: string;
  findings_count: number;
  findings: { title: string; severity: string; body: string }[];
  metrics_sampled?: { code: string; value: any }[];
  confidence?: number;
}

export interface RenderedMemory {
  company: string;
  observations: { id?: string; content: string; category?: string }[];
}

export interface AgentDialogueStep {
  step: number;
  from_agent: string;
  to_agent: string;
  message: string;
  tool?: string | null;
  status?: string;
}

export interface SearchPlan {
  intent_summary: string;
  financial_domain?: string;
  target_entity?: string;
  metric_codes?: string[];
  period?: string;
  selected_tools: string[];
  rag_query?: string;
  tavily_query?: string;
  diagnostic_metric_id?: number | string | null;
  diagnostic_metric_label?: string | null;
  metric_queries?: string[];
  requires_web_validation?: boolean;
  reasoning?: string;
  a2a_dialogue?: AgentDialogueStep[];
}

export interface RenderedOutput {
  format: "narrative" | "table" | "chart" | "diagnostic" | "agent_trace" | "memory" | string;
  citations?: string[];
  tool_used?: string;
  search_plan?: SearchPlan;
  a2a_dialogue?: AgentDialogueStep[];
  table?: RenderedTable;
  chart?: Chart;
  diagnostic?: RenderedDiagnostic;
  agent?: RenderedAgent;
  memory?: RenderedMemory;
}

export interface QaResponse {
  answer: string;
  citations: string[];
  route: string;
  search_plan?: SearchPlan;
  chart?: Chart | null;
  report_updated?: boolean;
  tool_used?: string;
  format?: string;
  rendered_output?: RenderedOutput;
  agent_invocations?: string[];
  telemetry?: {
    latency_ms: number;
    model: string;
    persona: string;
    temperature: number;
    search_plan?: SearchPlan;
  };
}

export interface Industry { key: string; label: string }

export interface IndustryList { source: string; as_of: string; industries: Industry[] }

export interface BenchmarkItem {
  metric_code: string;
  period_end: string;
  value: number;
  unit: string;
  p25: number;
  median: number;
  p75: number;
  quartile: 1 | 2 | 3 | 4;
  lower_is_better: boolean;
  verdict: "better" | "in_line" | "worse";
}

export interface Benchmarks { industry: string; label: string; source: string; as_of: string; items: BenchmarkItem[] }

export interface StatementRow {
  account_id: string;
  account_name: string;
  values: Record<string, number | null>;
  change: Record<string, number | null>;
  change_pct: Record<string, number | null>;
  common_size: Record<string, number | null>;
}

export interface BridgeStep { label: string; amount: number; kind: "start" | "delta" | "end"; account_id?: string | null }

/** GET /api/jobs/<id>/analysis -- the detailed statement analysis (tools/calc/detailed_analysis.py). */
export interface DetailedAnalysis {
  periods: string[];
  statements: { PL: StatementRow[]; BS: StatementRow[]; CF: StatementRow[]; [k: string]: StatementRow[] };
  dupont: { period: string; net_margin: number; asset_turnover: number; equity_multiplier: number; roe: number }[];
  growth: { label: string; metric_code: string; first_period: string; last_period: string; first: number; last: number; years: number; cagr: number | null }[];
  profit_bridge: { from_period: string; to_period: string; steps: BridgeStep[]; unexplained: number; reconciled: boolean } | null;
  leverage_liquidity: { period: string; working_capital: number | null; total_debt: number | null; net_debt: number | null; ebitda: number | null; net_debt_to_ebitda: number | null }[];
  bank: {
    monthly: { month: string; inflow: number; outflow: number; net: number; txn_count: number; closing_balance: number | null }[];
    top_inflows: { counterparty: string; amount: number; share: number | null }[];
    top_outflows: { counterparty: string; amount: number; share: number | null }[];
    totals: { inflow: number; outflow: number; net: number; months: number; txn_count: number; avg_monthly_net: number | null } | null;
  };
}

export interface DataExplorerAttributeRow {
  attribute_name: string;
  account_id: string;
  account_name: string;
  sheet: string;
  unit: string;
  source_doc: string;
  values: Record<string, number | null>;
  change_pct: Record<string, number | null>;
  order_index?: number;
}

export interface DataExplorerColumn {
  key: string;
  label: string;
  account_id?: string;
  type: string;
  unit?: string;
}

export interface DataExplorerResult {
  summary: {
    total_attributes: number;
    total_periods: number;
    total_facts: number;
    sheets: string[];
  };
  sheets: string[];
  periods: string[];
  row_format: {
    sheets: Record<string, DataExplorerAttributeRow[]>;
    all: DataExplorerAttributeRow[];
  };
  column_format: {
    sheets: Record<string, {
      columns: DataExplorerColumn[];
      rows: Record<string, any>[];
      total_attributes: number;
      total_periods: number;
    }>;
  };
}

export interface AddDocumentsResult { job_id: string; status: string; added: string[]; skipped: string[] }

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  system_prompt: string;
  skills: string[];
  assigned_tools: string[];
  model_tier: "default" | "fast" | "reasoning" | "custom" | string;
  is_builtin: boolean;
  allowed_peers: string[];
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface MCPEndpoint {
  id: string;
  name: string;
  endpoint_url: string;
  transport: "internal" | "sse" | "http" | "stdio" | string;
  auth_token?: string | null;
  status: "active" | "offline" | "error" | string;
  status_message?: string | null;
  cached_tools: MCPTool[];
  tool_count: number;
  last_synced_at?: string | null;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  toolset: string;
  endpoint_id?: string;
  endpoint_name?: string;
}

export interface A2AMessage {
  id: string;
  job_id: string | null;
  conversation_id: string;
  sender_agent: string;
  recipient_agent: string;
  message_type: "REQUEST" | "RESPONSE" | "DELEGATE" | "CHALLENGE" | "INFORM" | "BROADCAST" | string;
  intent: string;
  payload: Record<string, any>;
  correlation_id?: string | null;
  created_at: string;
}
