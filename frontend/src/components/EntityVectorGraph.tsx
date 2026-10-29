import { useState, useMemo, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Pause,
  Play,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  Activity,
} from "lucide-react";
import type { Job, TaskRun } from "../lib/types";
import { isActive } from "../lib/pipeline";

// =============================================================================
// Pixel Art Mini Icons for Agents (Crisp SVG 16x16 Matrices)
// =============================================================================

export type AgentRoleType = "hub" | "ingestion" | "ratio" | "forensic" | "risk" | "memory" | "synthesis";
export type NodeStatus = "idle" | "working" | "done" | "review" | "failed";

export function PixelAgentIcon({
  type,
  status = "idle",
  size = 20,
}: {
  type: AgentRoleType;
  status?: NodeStatus;
  size?: number;
}) {
  const primaryColor =
    status === "working"
      ? "#0284c7" // energetic blue
      : status === "done"
      ? "#16a34a" // auditor green
      : status === "review"
      ? "#d97706" // manila amber
      : status === "failed"
      ? "#dc2626" // red ink
      : "#64748b"; // muted graphite

  const accentColor =
    status === "working"
      ? "#38bdf8"
      : status === "done"
      ? "#4ade80"
      : status === "review"
      ? "#fcd34d"
      : status === "failed"
      ? "#f87171"
      : "#94a3b8";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ shapeRendering: "crispEdges", flexShrink: 0 }}
    >
      {type === "hub" && (
        <>
          <rect x="3" y="2" width="10" height="12" fill={primaryColor} />
          <rect x="4" y="3" width="8" height="10" fill="#0f172a" />
          <rect x="5" y="4" width="2" height="2" fill={accentColor} />
          <rect x="9" y="4" width="2" height="2" fill={accentColor} />
          <rect x="5" y="7" width="6" height="2" fill={primaryColor} />
          <rect x="5" y="10" width="2" height="1" fill="#38bdf8" />
          <rect x="8" y="10" width="3" height="1" fill="#22c55e" />
        </>
      )}

      {type === "ingestion" && (
        <>
          <rect x="4" y="2" width="8" height="11" fill={primaryColor} />
          <rect x="5" y="3" width="6" height="9" fill="#ffffff" />
          <rect x="6" y="5" width="4" height="1" fill="#475569" />
          <rect x="6" y="7" width="4" height="1" fill="#475569" />
          <rect x="6" y="9" width="3" height="1" fill="#475569" />
          <rect x="2" y="8" width="12" height="2" fill={accentColor} />
        </>
      )}

      {type === "ratio" && (
        <>
          <rect x="3" y="2" width="10" height="12" fill={primaryColor} />
          <rect x="4" y="3" width="8" height="4" fill="#0f172a" />
          <rect x="5" y="4" width="2" height="2" fill={accentColor} />
          <rect x="9" y="4" width="2" height="2" fill={accentColor} />
          <rect x="5" y="8" width="2" height="2" fill="#cbd5e1" />
          <rect x="9" y="8" width="2" height="2" fill="#cbd5e1" />
          <rect x="5" y="11" width="2" height="2" fill="#cbd5e1" />
          <rect x="9" y="11" width="2" height="2" fill={accentColor} />
        </>
      )}

      {type === "forensic" && (
        <>
          <rect x="3" y="3" width="10" height="8" fill={primaryColor} />
          <rect x="5" y="5" width="2" height="2" fill="#ffffff" />
          <rect x="9" y="5" width="2" height="2" fill="#38bdf8" />
          <rect x="4" y="2" width="8" height="1" fill="#0f172a" />
          <rect x="10" y="8" width="4" height="4" fill={accentColor} />
          <rect x="11" y="9" width="2" height="2" fill="#ffffff" />
          <rect x="13" y="12" width="2" height="3" fill={primaryColor} />
        </>
      )}

      {type === "risk" && (
        <>
          <rect x="3" y="2" width="10" height="4" fill={primaryColor} />
          <rect x="4" y="6" width="8" height="5" fill={primaryColor} />
          <rect x="6" y="11" width="4" height="3" fill={primaryColor} />
          <rect x="7" y="14" width="2" height="1" fill={primaryColor} />
          <rect x="5" y="4" width="6" height="5" fill="#ffffff" />
          <rect x="7" y="5" width="2" height="3" fill={accentColor} />
          <rect x="6" y="7" width="4" height="1" fill={accentColor} />
        </>
      )}

      {type === "memory" && (
        <>
          <rect x="3" y="2" width="10" height="12" fill={primaryColor} />
          <rect x="5" y="2" width="6" height="4" fill="#f8fafc" />
          <rect x="7" y="3" width="2" height="2" fill="#0f172a" />
          <rect x="5" y="8" width="6" height="5" fill="#f8fafc" />
          <rect x="6" y="9" width="4" height="1" fill={accentColor} />
          <rect x="6" y="11" width="3" height="1" fill="#64748b" />
        </>
      )}

      {type === "synthesis" && (
        <>
          <rect x="4" y="3" width="8" height="8" fill={primaryColor} />
          <rect x="6" y="1" width="4" height="2" fill={accentColor} />
          <rect x="6" y="11" width="4" height="2" fill={accentColor} />
          <rect x="1" y="6" width="2" height="4" fill={accentColor} />
          <rect x="13" y="6" width="2" height="4" fill={accentColor} />
          <rect x="6" y="5" width="4" height="4" fill="#ffffff" />
          <rect x="7" y="6" width="2" height="2" fill={primaryColor} />
        </>
      )}
    </svg>
  );
}

// =============================================================================
// 3D Neural Network Topology & Clean Spatial Layout
// =============================================================================

export interface NeuralNode3D {
  id: string;
  name: string;
  shortLabel: string;
  type: AgentRoleType;
  layer: number; // 0=Input, 1=Features, 2=Inference, 3=Memory, 4=Synthesis
  layerName: string;
  description: string;
  tools: string[];
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface SynapseEdge {
  source: string;
  target: string;
  weight: number;
}

export interface DataParticle {
  edgeIndex: number;
  progress: number; // 0.0 to 1.0
  speed: number;
  color: string;
  size: number;
}

// 5-Step Process Model Walkthrough Specification
export interface ModelProcessStep {
  step: number; // 1 to 5
  layer: number; // 0 to 4
  title: string;
  subtitle: string;
  phase: string;
  description: string;
  nodeIds: string[];
  cognitiveOperations: string[];
  tools: string[];
  inputData: string;
  outputDeliverable: string;
  latencyEst: string;
}

export const MODEL_PROCESS_STEPS: ModelProcessStep[] = [
  {
    step: 1,
    layer: 0,
    title: "Multi-Modal Ingestion & Fast Parsing",
    subtitle: "Input Sensory Layer (x = -260)",
    phase: "01 SENSORY",
    description: "Converts raw unstructured documents (10-K, 10-Q, Annual Reports, PDF/XLSX) into normalized financial statement tables and relational fact matrices using PyMuPDF and deterministic regex schema aligners.",
    nodeIds: ["ingestion", "facts_extractor"],
    cognitiveOperations: [
      "Multi-modal OCR & table boundary segmentation",
      "Financial period & currency canonicalization",
      "Deterministic line item classification (Revenue, COGS, Capex)",
      "Instant schema reconciliation across multiple filing periods",
    ],
    tools: ["data_query_facts", "PyMuPDF", "tesseract-ocr"],
    inputData: "Unstructured 10-K/10-Q PDFs, scanned images, Excel workbooks",
    outputDeliverable: "Relational facts ledger, standardized balance sheet, P&L & cash flow statements",
    latencyEst: "~150ms - 400ms",
  },
  {
    step: 2,
    layer: 1,
    title: "Canonical Ratio Engine & Working Capital",
    subtitle: "Feature Extraction Layer (x = -130)",
    phase: "02 FEATURES",
    description: "Applies deterministic financial mathematics to compute 24+ core liquidity, profitability, leverage, and activity ratios, while building working capital bridges and cash conversion cycle walks.",
    nodeIds: ["ratio_trend", "working_capital"],
    cognitiveOperations: [
      "EBITDA, Operating Margin, Gross Margin & Net Margin calculations",
      "Cash Conversion Cycle (DSO, DIO, DPO) timing diagnostics",
      "Working capital expansion/contraction bridge reconciliation",
      "Sequential quarter-over-quarter and year-over-year growth variance",
    ],
    tools: ["financial_compute_ratios", "financial_detailed_analysis"],
    inputData: "Standardized relational financial statements",
    outputDeliverable: "24-factor ratio time series, working capital waterfall bridges, leverage ratios",
    latencyEst: "~50ms - 120ms",
  },
  {
    step: 3,
    layer: 2,
    title: "Deep Cognitive Forensics & Live Web Validation",
    subtitle: "Cognitive Inference Layer (x = 0)",
    phase: "03 INFERENCE",
    description: "Executes deep statistical forensics (modified Altman Z-score, Benford's Law anomaly detection, covenant stress) and connects directly to Tavily MCP for live web validation against SEC filings, market consensus, and peer benchmarks.",
    nodeIds: ["forensic_examiner", "risk_auditor", "tavily_validator"],
    cognitiveOperations: [
      "Statistical anomaly detection & footnote accounting inconsistency scans",
      "Altman Z-score bankruptcy probability & interest coverage distress stress-testing",
      "Live Internet cross-validation of metrics & claims via Tavily Search MCP",
      "External peer comparison & consensus revenue/earnings discrepancy checking",
    ],
    tools: ["analytics_detect_anomalies", "analytics_credit_risk", "tavily_validate_value", "tavily_search", "FastMCP SSE"],
    inputData: "Ratio matrices, accounting footnotes & metric values to verify",
    outputDeliverable: "Forensic anomaly ledger, Altman Z distress grade, verified Tavily live citations",
    latencyEst: "~350ms - 800ms",
  },
  {
    step: 4,
    layer: 3,
    title: "Long-Term Institutional Memory Synapses",
    subtitle: "Long-Term Memory Synapse (x = 130)",
    phase: "04 MEMORY",
    description: "Indexes cross-period insights into SQLite institutional memory. Evaluates historical management commentary, track records on forward guidance, recurring restatements, and company-specific accounting practices.",
    nodeIds: ["memory_synthesizer"],
    cognitiveOperations: [
      "Vector embedding and semantic indexing of entity historical observations",
      "Historical guidance vs actual execution delta evaluation",
      "Entity-specific risk register and longitudinal auditor note aggregation",
      "Multi-year trend persistence verification",
    ],
    tools: ["memory_query_entity", "memory_store_observation", "vector_similarity"],
    inputData: "Forensic anomalies, credit metrics, entity name & fiscal periods",
    outputDeliverable: "Longitudinal audit trail, historical guidance delta report, memory graph nodes",
    latencyEst: "~80ms - 200ms",
  },
  {
    step: 5,
    layer: 4,
    title: "Executive Synthesis & FinSight Copilot Delivery",
    subtitle: "Synthesis Output Layer (x = 260)",
    phase: "05 SYNTHESIS",
    description: "Combines all four preceding neural layers into executive deliverables: dynamic CFO dashboard charts, downloadable forensic audit PDF reports, and real-time streaming FinSight Copilot responses powered by NVIDIA Nemotron 3.5 Super VL.",
    nodeIds: ["synthesis"],
    cognitiveOperations: [
      "Multi-agent paper compilation and reconciliation audit trail",
      "Interactive SVG/Canvas CFO chart specifications and data viz generation",
      "Publication-grade PDF forensic audit pack assembly (ReportLab)",
      "FinSight Copilot agentic reasoning synthesis with citations & tools provenance",
    ],
    tools: ["visualization_chart_spec", "reportlab", "A2A Broker", "nemotron-3.5-vl"],
    inputData: "Ingested facts, ratios, anomaly flags, Tavily web checks, institutional memory",
    outputDeliverable: "Comprehensive forensic report, interactive charts, real-time verified copilot answers",
    latencyEst: "~200ms - 600ms",
  },
];

// 5-Layer Spacious Neural Coordinates (Generous horizontal & vertical breathing room)
export const NEURAL_NODES: NeuralNode3D[] = [
  // Layer 0: Sensory Ingestion (x = -260)
  {
    id: "ingestion",
    name: "Document Ingestion",
    shortLabel: "Ingestion",
    type: "ingestion",
    layer: 0,
    layerName: "Input Sensory Layer",
    description: "Multi-modal OCR parsing, layout segmentation & table extraction",
    tools: ["data_query_facts", "PyMuPDF", "tesseract-ocr"],
    x: -260,
    y: -46,
    z: -15,
    radius: 12,
  },
  {
    id: "facts_extractor",
    name: "Fact Extraction",
    shortLabel: "Facts",
    type: "ingestion",
    layer: 0,
    layerName: "Input Sensory Layer",
    description: "Structured relational facts and period alignment",
    tools: ["data_query_facts"],
    x: -260,
    y: 46,
    z: 15,
    radius: 12,
  },

  // Layer 1: Feature Extraction (x = -130)
  {
    id: "ratio_trend",
    name: "Ratio Engine",
    shortLabel: "Ratios",
    type: "ratio",
    layer: 1,
    layerName: "Feature Extraction Layer",
    description: "Deterministic financial ratio calculation & trend analysis",
    tools: ["financial_compute_ratios", "financial_detailed_analysis"],
    x: -130,
    y: -50,
    z: 20,
    radius: 13,
  },
  {
    id: "working_capital",
    name: "Working Capital Bridge",
    shortLabel: "Capital",
    type: "ratio",
    layer: 1,
    layerName: "Feature Extraction Layer",
    description: "Cash conversion cycle & liquidity balance tie-out",
    tools: ["financial_detailed_analysis"],
    x: -130,
    y: 50,
    z: -20,
    radius: 12,
  },

  // Layer 2: Deep Cognitive Inference (x = 0)
  {
    id: "forensic_examiner",
    name: "Forensic Examiner",
    shortLabel: "Forensics",
    type: "forensic",
    layer: 2,
    layerName: "Cognitive Inference Layer",
    description: "Statistical outlier detection & footnote anomaly verification",
    tools: ["analytics_detect_anomalies", "search_document_rag"],
    x: 0,
    y: -50,
    z: -25,
    radius: 13,
  },
  {
    id: "risk_auditor",
    name: "Risk & Solvency",
    shortLabel: "Risk",
    type: "risk",
    layer: 2,
    layerName: "Cognitive Inference Layer",
    description: "Altman Z-score evaluation, covenant stress & debt monitoring",
    tools: ["analytics_credit_risk", "financial_health_score"],
    x: 0,
    y: 50,
    z: 25,
    radius: 13,
  },
  {
    id: "tavily_validator",
    name: "Tavily Web Validator",
    shortLabel: "Tavily",
    type: "forensic",
    layer: 2,
    layerName: "Cognitive Inference Layer",
    description: "Live Internet value validation, SEC/MCA benchmark cross-check & Tavily MCP",
    tools: ["tavily_validate_value", "tavily_search", "FastMCP SSE"],
    x: 0,
    y: 0,
    z: 35,
    radius: 13,
  },

  // Layer 3: Institutional Memory (x = 130)
  {
    id: "memory_synthesizer",
    name: "Institutional Memory",
    shortLabel: "Memory",
    type: "memory",
    layer: 3,
    layerName: "Long-Term Memory Synapse",
    description: "Longitudinal tracking of guidance, past filings & SQLite memory",
    tools: ["memory_query_entity", "memory_store_observation"],
    x: 130,
    y: 0,
    z: -15,
    radius: 13,
  },

  // Layer 4: Executive Synthesis (x = 260)
  {
    id: "synthesis",
    name: "Executive Synthesis",
    shortLabel: "Synthesis",
    type: "synthesis",
    layer: 4,
    layerName: "Synthesis Output Layer",
    description: "Multi-agent synthesis, working papers compilation & audit trail",
    tools: ["visualization_chart_spec", "reportlab", "A2A Broker", "nemotron-3.5-vl"],
    x: 260,
    y: 0,
    z: 15,
    radius: 14,
  },
];

// Clean forward synapses without cluttering cross-cuts
export const SYNAPSE_EDGES: SynapseEdge[] = [
  // Layer 0 -> Layer 1
  { source: "ingestion", target: "ratio_trend", weight: 0.9 },
  { source: "facts_extractor", target: "ratio_trend", weight: 0.9 },
  { source: "facts_extractor", target: "working_capital", weight: 0.85 },

  // Layer 1 -> Layer 2
  { source: "ratio_trend", target: "forensic_examiner", weight: 0.95 },
  { source: "ratio_trend", target: "risk_auditor", weight: 0.9 },
  { source: "ratio_trend", target: "tavily_validator", weight: 0.92 },
  { source: "working_capital", target: "risk_auditor", weight: 0.85 },

  // Layer 2 -> Layer 3 (Memory)
  { source: "forensic_examiner", target: "memory_synthesizer", weight: 0.85 },
  { source: "risk_auditor", target: "memory_synthesizer", weight: 0.85 },
  { source: "tavily_validator", target: "memory_synthesizer", weight: 0.88 },

  // Layer 3 & Layer 2 -> Layer 4 (Output Synthesis)
  { source: "memory_synthesizer", target: "synthesis", weight: 1.0 },
  { source: "forensic_examiner", target: "synthesis", weight: 0.9 },
  { source: "risk_auditor", target: "synthesis", weight: 0.9 },
  { source: "tavily_validator", target: "synthesis", weight: 0.95 },
];

const LAYER_HEADERS = [
  { step: 1, label: "01 SENSORY", x: -260 },
  { step: 2, label: "02 FEATURES", x: -130 },
  { step: 3, label: "03 INFERENCE", x: 0 },
  { step: 4, label: "04 MEMORY", x: 130 },
  { step: 5, label: "05 SYNTHESIS", x: 260 },
];

function drawCleanPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

export function EntityVectorGraph({
  job,
  tasks,
}: {
  job: Job;
  tasks: TaskRun[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Step-by-step walkthrough state
  const [activeStep, setActiveStep] = useState<number | "all">("all");
  const [isTourPlaying, setIsTourPlaying] = useState<boolean>(false);

  // Gentle default 3D camera angles for clear left-to-right layer separation
  const rotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0.16, pitch: 0.06 });
  const isDraggingRef = useRef<boolean>(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Map tasks to node state
  const nodeStates = useMemo(() => {
    const states: Record<string, { status: NodeStatus; run?: TaskRun }> = {};
    const isJobActive = isActive(job.status);
    const currentStage = job.stage;

    for (const node of NEURAL_NODES) {
      const matchingRuns = tasks.filter((t) => {
        const a = t.agent.toLowerCase();
        if (node.id === "ingestion" && (a.includes("extract") || a.includes("ingest") || a.includes("statement"))) return true;
        if (node.id === "facts_extractor" && (a.includes("fact") || a.includes("schema") || a.includes("reconcil"))) return true;
        if (node.id === "ratio_trend" && (a.includes("ratio") || a.includes("trend"))) return true;
        if (node.id === "working_capital" && (a.includes("cash") || a.includes("wc") || a.includes("capital"))) return true;
        if (node.id === "forensic_examiner" && (a.includes("anomaly") || a.includes("forensic") || a.includes("examiner"))) return true;
        if (node.id === "risk_auditor" && (a.includes("risk") || a.includes("credit") || a.includes("distress"))) return true;
        if (node.id === "tavily_validator" && (a.includes("tavily") || a.includes("web") || a.includes("valida"))) return true;
        if (node.id === "memory_synthesizer" && (a.includes("memory") || a.includes("knowledge") || a.includes("guidance"))) return true;
        if (node.id === "synthesis" && (a.includes("synth") || a.includes("delivery") || a.includes("report"))) return true;
        return a === node.id;
      });

      if (matchingRuns.length > 0) {
        const latest = matchingRuns[matchingRuns.length - 1];
        let st: NodeStatus = "done";
        if (latest.status === "running") st = "working";
        else if (latest.status === "failed") st = "failed";
        else if (latest.status === "needs_review" || latest.status === "partial") st = "review";
        states[node.id] = { status: st, run: latest };
      } else {
        let st: NodeStatus = "idle";
        if (isJobActive) {
          if (
            (currentStage === "data" && node.layer === 0) ||
            (currentStage === "analysis" && (node.layer === 1 || node.layer === 2)) ||
            (currentStage === "delivery" && (node.layer === 3 || node.layer === 4))
          ) {
            st = "working";
          } else if (
            (currentStage === "analysis" && node.layer === 0) ||
            (currentStage === "delivery" && node.layer < 4)
          ) {
            st = "done";
          }
        } else if (job.status === "COMPLETED") {
          st = "done";
        }
        states[node.id] = { status: st };
      }
    }
    return states;
  }, [job, tasks]);

  // Telemetry stats
  const stats = useMemo(() => {
    let completed = 0;
    let working = 0;
    for (const n of NEURAL_NODES) {
      const s = nodeStates[n.id]?.status;
      if (s === "done") completed++;
      if (s === "working") working++;
    }
    const percent = Math.round((completed / NEURAL_NODES.length) * 100);
    return { completed, working, percent };
  }, [nodeStates]);

  // Auto-tour step timer
  useEffect(() => {
    if (!isTourPlaying) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => {
        if (prev === "all") return 1;
        if (prev >= 5) return 1;
        return ((prev as number) + 1);
      });
    }, 4200);
    return () => clearInterval(interval);
  }, [isTourPlaying]);

  // Main 3D Canvas rendering loop with clean particle flow & step-by-step focus
  useEffect(() => {
    if (!isExpanded) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    // Streamlined particles for clean, non-congested flow
    const particles: DataParticle[] = [];
    const NUM_PARTICLES = 18;
    for (let i = 0; i < NUM_PARTICLES; i++) {
      const edgeIndex = Math.floor(Math.random() * SYNAPSE_EDGES.length);
      particles.push({
        edgeIndex,
        progress: Math.random(),
        speed: 0.005 + Math.random() * 0.006,
        color: Math.random() > 0.4 ? "#0284c7" : "#16a34a",
        size: 2.2,
      });
    }

    const render = () => {
      // Auto-rotation when not manually dragging
      if (autoRotate && !isDraggingRef.current) {
        rotationRef.current.yaw += 0.0016;
      }

      // Handle Retina / HiDPI crisp rendering
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const displayWidth = rect.width || 640;
      const displayHeight = 290;

      if (canvas.width !== Math.round(displayWidth * dpr) || canvas.height !== Math.round(displayHeight * dpr)) {
        canvas.width = Math.round(displayWidth * dpr);
        canvas.height = Math.round(displayHeight * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const width = displayWidth;
      const height = displayHeight;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      const yaw = rotationRef.current.yaw;
      const pitch = rotationRef.current.pitch;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosX = Math.cos(pitch);
      const sinX = Math.sin(pitch);
      const focalLength = 520;

      const activeLayer = typeof activeStep === "number" ? activeStep - 1 : null;

      // 1. Draw architectural layer column guides with step spotlight
      for (const col of LAYER_HEADERS) {
        const isCurrentStepLayer = activeLayer !== null && col.step - 1 === activeLayer;

        const x1 = col.x * cosY + 0 * sinY;
        const z1 = -col.x * sinY + 0 * cosY;
        const yTop = -95 * cosX - z1 * sinX;
        const zTop = -95 * sinX + z1 * cosX;
        const yBot = 95 * cosX - z1 * sinX;
        const zBot = 95 * sinX + z1 * cosX;

        const scaleTop = focalLength / (focalLength + zTop + 240);
        const scaleBot = focalLength / (focalLength + zBot + 240);
        const sxTop = centerX + x1 * scaleTop;
        const syTop = centerY + yTop * scaleTop;
        const sxBot = centerX + x1 * scaleBot;
        const syBot = centerY + yBot * scaleBot;

        // Active Step Spotlight Beam
        if (isCurrentStepLayer) {
          ctx.save();
          const beamWidth = 84 * ((scaleTop + scaleBot) / 2);
          const grad = ctx.createLinearGradient(sxTop, syTop, sxTop, syBot);
          grad.addColorStop(0, "rgba(2, 132, 199, 0.03)");
          grad.addColorStop(0.5, "rgba(2, 132, 199, 0.12)");
          grad.addColorStop(1, "rgba(2, 132, 199, 0.03)");
          ctx.fillStyle = grad;
          drawCleanPill(ctx, sxTop - beamWidth / 2, syTop, beamWidth, syBot - syTop, 12);
          ctx.fill();

          // Luminous active column line
          ctx.strokeStyle = "rgba(2, 132, 199, 0.55)";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sxTop, syTop);
          ctx.lineTo(sxBot, syBot);
          ctx.stroke();
          ctx.restore();
        } else {
          // Subtle column guide
          ctx.strokeStyle = activeLayer !== null ? "rgba(22, 33, 46, 0.03)" : "rgba(22, 33, 46, 0.05)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(sxTop, syTop);
          ctx.lineTo(sxBot, syBot);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Layer category header tag at top
        ctx.font = isCurrentStepLayer ? "700 9.5px 'IBM Plex Mono', monospace" : "600 9px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        if (isCurrentStepLayer) {
          // Pill badge for active layer header
          const headW = ctx.measureText(col.label).width + 14;
          drawCleanPill(ctx, sxTop - headW / 2, syTop - 20, headW, 16, 3);
          ctx.fillStyle = "rgba(2, 132, 199, 0.95)";
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.fillText(col.label, sxTop, syTop - 8);
        } else {
          ctx.fillStyle = activeLayer !== null ? "rgba(22, 33, 46, 0.25)" : "rgba(22, 33, 46, 0.4)";
          ctx.fillText(col.label, sxTop, syTop - 4);
        }
      }

      // 2. Project all 3D nodes to 2D screen space
      interface ProjectedNode {
        node: NeuralNode3D;
        sx: number;
        sy: number;
        sz: number;
        scale: number;
        status: NodeStatus;
        isStepActive: boolean;
        isStepCompleted: boolean;
        isStepUpcoming: boolean;
      }

      const projected: ProjectedNode[] = [];
      for (const node of NEURAL_NODES) {
        // Rotate around Y (yaw)
        const x1 = node.x * cosY + node.z * sinY;
        const z1 = -node.x * sinY + node.z * cosY;

        // Rotate around X (pitch)
        const y1 = node.y * cosX - z1 * sinX;
        const z2 = node.y * sinX + z1 * cosX;

        // Perspective divide
        const scale = focalLength / (focalLength + z2 + 240);
        const sx = centerX + x1 * scale;
        const sy = centerY + y1 * scale;
        const status = nodeStates[node.id]?.status || "idle";

        const isStepActive = activeLayer !== null && node.layer === activeLayer;
        const isStepCompleted = activeLayer !== null && node.layer < activeLayer;
        const isStepUpcoming = activeLayer !== null && node.layer > activeLayer;

        projected.push({
          node,
          sx,
          sy,
          sz: z2,
          scale,
          status,
          isStepActive,
          isStepCompleted,
          isStepUpcoming,
        });
      }

      const projMap = new Map(projected.map((p) => [p.node.id, p]));

      // 3. Render Synapses (Edges)
      for (let i = 0; i < SYNAPSE_EDGES.length; i++) {
        const edge = SYNAPSE_EDGES[i];
        const p1 = projMap.get(edge.source);
        const p2 = projMap.get(edge.target);
        if (!p1 || !p2) continue;

        const avgScale = (p1.scale + p2.scale) / 2;

        // Step-specific connection logic:
        const isStepIncomingEdge = activeLayer !== null && p2.node.layer === activeLayer;
        const isStepPriorEdge = activeLayer !== null && p1.node.layer < activeLayer && p2.node.layer <= activeLayer;
        const isStepFutureEdge = activeLayer !== null && (p1.node.layer >= activeLayer || p2.node.layer > activeLayer) && !isStepIncomingEdge;

        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);

        if (isStepIncomingEdge) {
          // Highlighting active step intake synapses!
          ctx.strokeStyle = "rgba(2, 132, 199, 0.95)";
          ctx.lineWidth = 2.4 * avgScale;
          ctx.setLineDash([5, 4]);
        } else if (isStepPriorEdge) {
          // Completed prior steps
          ctx.strokeStyle = "rgba(22, 163, 74, 0.45)";
          ctx.lineWidth = 1.2 * avgScale;
          ctx.setLineDash([]);
        } else if (isStepFutureEdge) {
          // Dimmed future steps
          ctx.strokeStyle = "rgba(22, 33, 46, 0.04)";
          ctx.lineWidth = 0.7 * avgScale;
          ctx.setLineDash([]);
        } else {
          // Global "all" view
          const isEdgeActive = p1.status === "working" || p2.status === "working";
          const isEdgeComplete = p1.status === "done" && p2.status === "done";

          if (isEdgeActive) {
            ctx.strokeStyle = "rgba(2, 132, 199, 0.7)";
            ctx.lineWidth = 1.6 * avgScale;
            ctx.setLineDash([4, 4]);
          } else if (isEdgeComplete) {
            ctx.strokeStyle = "rgba(22, 163, 74, 0.35)";
            ctx.lineWidth = 1.1 * avgScale;
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = "rgba(22, 33, 46, 0.09)";
            ctx.lineWidth = 0.8 * avgScale;
            ctx.setLineDash([]);
          }
        }

        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 4. Render Data-Flow Particles with subtle head & trail
      for (const pt of particles) {
        pt.progress += pt.speed;
        if (pt.progress >= 1.0) {
          pt.progress = 0.0;
          // When focusing on a step, prioritize feeding into or out of activeLayer
          if (activeLayer !== null) {
            const relevantEdgeIndices = SYNAPSE_EDGES
              .map((e, idx) => {
                const s = NEURAL_NODES.find((n) => n.id === e.source);
                const t = NEURAL_NODES.find((n) => n.id === e.target);
                if (t?.layer === activeLayer || s?.layer === activeLayer) return idx;
                return -1;
              })
              .filter((idx) => idx !== -1);
            if (relevantEdgeIndices.length > 0) {
              pt.edgeIndex = relevantEdgeIndices[Math.floor(Math.random() * relevantEdgeIndices.length)];
            } else {
              pt.edgeIndex = Math.floor(Math.random() * SYNAPSE_EDGES.length);
            }
          } else {
            pt.edgeIndex = Math.floor(Math.random() * SYNAPSE_EDGES.length);
          }
        }

        const edge = SYNAPSE_EDGES[pt.edgeIndex];
        const p1 = projMap.get(edge.source);
        const p2 = projMap.get(edge.target);
        if (!p1 || !p2) continue;

        const isStepIncoming = activeLayer !== null && p2.node.layer === activeLayer;
        const isStepFuture = activeLayer !== null && p1.node.layer > activeLayer;

        if (isStepFuture) continue; // Don't show particles on future stages

        // Position along edge
        const curX = p1.sx + (p2.sx - p1.sx) * pt.progress;
        const curY = p1.sy + (p2.sy - p1.sy) * pt.progress;
        const curScale = p1.scale + (p2.scale - p1.scale) * pt.progress;
        const pRadius = (isStepIncoming ? 3.4 : 2.0) * curScale;

        // Particle Glow
        ctx.beginPath();
        ctx.arc(curX, curY, pRadius * 1.9, 0, Math.PI * 2);
        ctx.fillStyle = isStepIncoming ? "rgba(56, 189, 248, 0.45)" : "rgba(22, 163, 74, 0.2)";
        ctx.fill();

        // Particle Core
        ctx.beginPath();
        ctx.arc(curX, curY, pRadius, 0, Math.PI * 2);
        ctx.fillStyle = isStepIncoming ? "#0284c7" : pt.color;
        ctx.fill();
      }

      // 5. Render 3D Neural Nodes (Sorted by depth Z for correct visual occlusion)
      const sortedNodes = [...projected].sort((a, b) => a.sz - b.sz);

      for (const pn of sortedNodes) {
        const { node, sx, sy, scale, status, isStepActive, isStepCompleted, isStepUpcoming } = pn;
        const isHovered = hoveredNodeId === node.id;
        const isSelected = selectedNodeId === node.id;
        const isWorking = status === "working" || isStepActive;
        const isDone = status === "done" || isStepCompleted;
        const isReview = status === "review";
        const isFailed = status === "failed";

        // Alpha dimming for future steps
        const nodeAlpha = isStepUpcoming ? 0.22 : 1.0;
        ctx.save();
        ctx.globalAlpha = nodeAlpha;

        const baseRadius = node.radius * scale * (isHovered || isSelected || isStepActive ? 1.25 : 1.0);

        const statusColor = isStepActive
          ? "#0284c7"
          : isWorking
          ? "#0284c7"
          : isDone
          ? "#16a34a"
          : isReview
          ? "#d97706"
          : isFailed
          ? "#dc2626"
          : "#64748b";

        // Active pulsing ring for working nodes or active walkthrough step
        if (isStepActive || isWorking) {
          const pulse = (Math.sin(Date.now() * 0.006) + 1) / 2;
          ctx.beginPath();
          ctx.arc(sx, sy, baseRadius + 4 + pulse * 7, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(2, 132, 199, ${0.4 + pulse * 0.4})`;
          ctx.lineWidth = isStepActive ? 1.8 : 1.2;
          ctx.stroke();

          // Second ambient halo when step is active
          if (isStepActive) {
            ctx.beginPath();
            ctx.arc(sx, sy, baseRadius + 12 + pulse * 6, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(56, 189, 248, ${0.15 + pulse * 0.15})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // Node background circle
        ctx.beginPath();
        ctx.arc(sx, sy, baseRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // Node border ring
        ctx.beginPath();
        ctx.arc(sx, sy, baseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected
          ? "#0284c7"
          : isStepActive
          ? "#0284c7"
          : isWorking
          ? "#0284c7"
          : isDone
          ? "#16a34a"
          : isReview
          ? "#d97706"
          : "rgba(22, 33, 46, 0.2)";
        ctx.lineWidth = isSelected ? 2.8 : isStepActive ? 2.4 : isWorking ? 2 : 1.2;
        ctx.stroke();

        // Inner nucleus dot
        ctx.beginPath();
        ctx.arc(sx, sy, baseRadius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();

        // Crisp floating badge pill underneath
        const label = node.shortLabel;
        ctx.font = isStepActive || isSelected ? "700 11px 'IBM Plex Mono', monospace" : "600 10.5px 'IBM Plex Mono', monospace";
        const textWidth = ctx.measureText(label).width;
        const pillWidth = textWidth + (isStepActive ? 28 : 20);
        const pillHeight = isStepActive ? 19 : 17;
        const pillX = sx - pillWidth / 2;
        const pillY = sy + baseRadius + 5;

        // Pill shadow & fill
        ctx.beginPath();
        drawCleanPill(ctx, pillX, pillY, pillWidth, pillHeight, 3.5);
        ctx.fillStyle = isStepActive ? "#0f172a" : "rgba(255, 255, 255, 0.95)";
        ctx.fill();

        // Pill border
        ctx.strokeStyle = isSelected || isHovered || isStepActive ? "#0284c7" : "rgba(22, 33, 46, 0.12)";
        ctx.lineWidth = isSelected || isHovered || isStepActive ? 1.5 : 0.8;
        ctx.stroke();

        // Pill status pip
        ctx.beginPath();
        ctx.arc(pillX + 7, pillY + pillHeight / 2, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isStepActive ? "#38bdf8" : statusColor;
        ctx.fill();

        // Pill label
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isStepActive ? "#ffffff" : isSelected || isHovered ? "#0284c7" : "var(--ink, #16212e)";
        ctx.fillText(label, pillX + 14, pillY + pillHeight / 2);

        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isExpanded, autoRotate, nodeStates, hoveredNodeId, selectedNodeId, activeStep]);

  // Handle Canvas mouse drag to rotate in 3D
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingRef.current) {
      const dx = e.clientX - lastMousePosRef.current.x;
      const dy = e.clientY - lastMousePosRef.current.y;
      rotationRef.current.yaw += dx * 0.006;
      rotationRef.current.pitch = Math.max(-0.5, Math.min(0.5, rotationRef.current.pitch + dy * 0.006));
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    } else {
      // Hit-test nodes on hover in CSS pixel space
      const width = rect.width || 640;
      const height = 290;
      const centerX = width / 2;
      const centerY = height / 2;
      const yaw = rotationRef.current.yaw;
      const pitch = rotationRef.current.pitch;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const cosX = Math.cos(pitch), sinX = Math.sin(pitch);
      const focalLength = 520;

      let found: string | null = null;
      for (const node of NEURAL_NODES) {
        const x1 = node.x * cosY + node.z * sinY;
        const z1 = -node.x * sinY + node.z * cosY;
        const y1 = node.y * cosX - z1 * sinX;
        const z2 = node.y * sinX + z1 * cosX;
        const scale = focalLength / (focalLength + z2 + 240);
        const sx = centerX + x1 * scale;
        const sy = centerY + y1 * scale;

        const dist = Math.hypot(mouseX - sx, mouseY - sy);
        if (dist <= (node.radius * scale + 14)) {
          found = node.id;
          break;
        }
      }
      setHoveredNodeId(found);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleCanvasClick = () => {
    if (hoveredNodeId) {
      setSelectedNodeId(hoveredNodeId === selectedNodeId ? null : hoveredNodeId);
    }
  };

  const resetCamera = () => {
    rotationRef.current = { yaw: 0.16, pitch: 0.06 };
  };

  // Step navigation helpers
  const handlePrevStep = () => {
    setIsTourPlaying(false);
    if (activeStep === "all") setActiveStep(5);
    else if (activeStep <= 1) setActiveStep(5);
    else setActiveStep(activeStep - 1);
  };

  const handleNextStep = () => {
    setIsTourPlaying(false);
    if (activeStep === "all") setActiveStep(1);
    else if (activeStep >= 5) setActiveStep(1);
    else setActiveStep(activeStep + 1);
  };

  const currentStepData = typeof activeStep === "number" ? MODEL_PROCESS_STEPS[activeStep - 1] : null;
  const selectedNode = NEURAL_NODES.find((n) => n.id === selectedNodeId || n.id === hoveredNodeId);
  const selectedState = selectedNode ? nodeStates[selectedNode.id] : null;

  return (
    <div
      ref={containerRef}
      style={{
        border: "1px solid var(--rule, rgba(22, 33, 46, 0.12))",
        borderRadius: "var(--r-md, 6px)",
        backgroundColor: "var(--sheet, #ffffff)",
        marginBottom: "1.25rem",
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      {/* 3D Neural Telemetry Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.6rem 0.85rem",
          backgroundColor: "var(--paper-sunk, #eef0ec)",
          borderBottom: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
          fontSize: "12px",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <PixelAgentIcon type="hub" status={stats.working > 0 ? "working" : "done"} size={16} />
          <span style={{ fontWeight: 600, color: "var(--ink, #16212e)", letterSpacing: "-0.01em" }}>
            3D MODEL PROCESS GRAPH
          </span>
          <span
            style={{
              padding: "1px 6px",
              borderRadius: "3px",
              backgroundColor: stats.working > 0 ? "var(--tick-wash, #e8f3ed)" : "var(--paper-sunk, #eef0ec)",
              color: stats.working > 0 ? "var(--tick-deep, #13654a)" : "var(--graphite, #7a838f)",
              fontSize: "10.5px",
              fontWeight: 600,
            }}
          >
            {stats.working > 0 ? `${stats.working} NEURONS ACTIVE` : job.status}
          </span>
          <span style={{ color: "var(--graphite, #7a838f)", fontSize: "10.5px", display: "inline-flex", gap: "0.5rem" }}>
            <span>• Drag to rotate</span>
            <span>• Step-by-Step Walkthrough active</span>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Controls: Auto-Rotate, Reset Camera, Collapse */}
          <button
            type="button"
            onClick={() => setAutoRotate(!autoRotate)}
            title={autoRotate ? "Pause 3D rotation" : "Resume 3D auto-rotation"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              background: autoRotate ? "var(--sheet, #ffffff)" : "none",
              border: "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
              borderRadius: "4px",
              padding: "2px 6px",
              cursor: "pointer",
              fontSize: "11px",
              color: "var(--ink-2, #4a5563)",
              fontFamily: "inherit",
            }}
          >
            {autoRotate ? <Pause size={11} /> : <Play size={11} />}
            <span>3D ROTATION</span>
          </button>

          <button
            type="button"
            onClick={resetCamera}
            title="Reset 3D camera angle"
            style={{
              display: "flex",
              alignItems: "center",
              background: "none",
              border: "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
              borderRadius: "4px",
              padding: "2px 5px",
              cursor: "pointer",
              color: "var(--ink-2, #4a5563)",
            }}
          >
            <RotateCcw size={11} />
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "11px" }}>
            <span style={{ color: "var(--graphite, #7a838f)" }}>SYNC:</span>
            <span style={{ fontWeight: 600, color: "var(--ink, #16212e)" }}>{stats.percent}%</span>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.2rem",
              background: "none",
              border: "1px solid var(--rule, rgba(22, 33, 46, 0.15))",
              borderRadius: "4px",
              padding: "2px 6px",
              cursor: "pointer",
              fontSize: "11px",
              color: "var(--ink-2, #4a5563)",
              fontFamily: "inherit",
            }}
          >
            {isExpanded ? <>Collapse <ChevronUp size={11} /></> : <>Expand <ChevronDown size={11} /></>}
          </button>
        </div>
      </div>

      {/* Step-by-Step Walkthrough HUD Controller */}
      {isExpanded && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.6rem",
            padding: "0.5rem 0.85rem",
            backgroundColor: "#ffffff",
            borderBottom: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "11px",
          }}
        >
          {/* Step Pill Selectors */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
            <span style={{ color: "var(--graphite, #7a838f)", fontWeight: 600, marginRight: "0.2rem" }}>
              STEP TOUR:
            </span>
            <button
              type="button"
              onClick={() => {
                setIsTourPlaying(false);
                setActiveStep("all");
              }}
              style={{
                padding: "3px 8px",
                borderRadius: "4px",
                border: activeStep === "all" ? "1px solid #0284c7" : "1px solid var(--rule-soft, rgba(22, 33, 46, 0.12))",
                backgroundColor: activeStep === "all" ? "#0284c7" : "var(--paper-sunk, #eef0ec)",
                color: activeStep === "all" ? "#ffffff" : "var(--ink-2, #4a5563)",
                fontWeight: activeStep === "all" ? 600 : 500,
                cursor: "pointer",
                fontSize: "10.5px",
              }}
            >
              ALL NODES
            </button>

            {MODEL_PROCESS_STEPS.map((step) => {
              const isSelected = activeStep === step.step;
              return (
                <button
                  key={step.step}
                  type="button"
                  onClick={() => {
                    setIsTourPlaying(false);
                    setActiveStep(step.step);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    border: isSelected ? "1px solid #0284c7" : "1px solid var(--rule-soft, rgba(22, 33, 46, 0.12))",
                    backgroundColor: isSelected ? "rgba(2, 132, 199, 0.12)" : "transparent",
                    color: isSelected ? "#0284c7" : "var(--ink-2, #4a5563)",
                    fontWeight: isSelected ? 700 : 500,
                    cursor: "pointer",
                    fontSize: "10.5px",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "50%",
                      backgroundColor: isSelected ? "#0284c7" : "rgba(22, 33, 46, 0.12)",
                      color: isSelected ? "#ffffff" : "var(--ink-2, #4a5563)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "9px",
                      fontWeight: 700,
                    }}
                  >
                    {step.step}
                  </span>
                  <span>{step.phase.split(" ")[1]}</span>
                </button>
              );
            })}
          </div>

          {/* Stepper Controls: Prev, Tour Play, Next */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <button
              type="button"
              onClick={handlePrevStep}
              title="Previous process step"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.2rem",
                padding: "2px 6px",
                borderRadius: "3px",
                border: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.15))",
                background: "none",
                cursor: "pointer",
                color: "var(--ink-2, #4a5563)",
                fontSize: "10.5px",
              }}
            >
              <ChevronLeft size={12} />
              <span>PREV</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isTourPlaying && activeStep === "all") {
                  setActiveStep(1);
                }
                setIsTourPlaying(!isTourPlaying);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "2px 8px",
                borderRadius: "3px",
                border: "1px solid #0284c7",
                backgroundColor: isTourPlaying ? "#0284c7" : "rgba(2, 132, 199, 0.08)",
                color: isTourPlaying ? "#ffffff" : "#0284c7",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "10.5px",
              }}
            >
              {isTourPlaying ? <Pause size={11} /> : <Play size={11} />}
              <span>{isTourPlaying ? "PAUSE TOUR" : "AUTO TOUR"}</span>
            </button>

            <button
              type="button"
              onClick={handleNextStep}
              title="Next process step"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.2rem",
                padding: "2px 6px",
                borderRadius: "3px",
                border: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.15))",
                background: "none",
                cursor: "pointer",
                color: "var(--ink-2, #4a5563)",
                fontSize: "10.5px",
              }}
            >
              <span>NEXT</span>
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* 3D Interactive Canvas & Particle Flow Engine */}
      {isExpanded && (
        <div style={{ position: "relative", width: "100%", backgroundColor: "var(--paper, #f5f6f3)" }}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleCanvasClick}
            style={{
              width: "100%",
              height: "290px",
              display: "block",
              cursor: isDraggingRef.current ? "grabbing" : hoveredNodeId ? "pointer" : "grab",
            }}
          />

          {/* Detailed Model Process Step Card (Showcase when a step is active) */}
          {currentStepData && (
            <div
              style={{
                padding: "0.85rem 1rem",
                backgroundColor: "#ffffff",
                borderTop: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                borderBottom: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                fontSize: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  marginBottom: "0.6rem",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontWeight: 700,
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "3px",
                        backgroundColor: "#0284c7",
                        color: "#ffffff",
                        letterSpacing: "0.04em",
                      }}
                    >
                      STEP {currentStepData.step} OF 5
                    </span>
                    <strong style={{ fontSize: "14px", color: "var(--ink, #16212e)" }}>
                      {currentStepData.title}
                    </strong>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "11px",
                        color: "var(--graphite, #7a838f)",
                      }}
                    >
                      [{currentStepData.subtitle}]
                    </span>
                  </div>
                  <p style={{ margin: "4px 0 0 0", color: "var(--ink-2, #4a5563)", lineHeight: 1.5, fontSize: "12px" }}>
                    {currentStepData.description}
                  </p>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "10.5px",
                    color: "var(--graphite, #7a838f)",
                    backgroundColor: "var(--paper-sunk, #eef0ec)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                  }}
                >
                  <Activity size={12} color="#0284c7" />
                  <span>LATENCY: {currentStepData.latencyEst}</span>
                </div>
              </div>

              {/* Step Cognitive Breakdown Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "0.75rem",
                  marginTop: "0.65rem",
                  paddingTop: "0.65rem",
                  borderTop: "1px dashed var(--rule-soft, rgba(22, 33, 46, 0.08))",
                }}
              >
                {/* Cognitive Operations */}
                <div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontWeight: 600,
                      fontSize: "10.5px",
                      color: "var(--ink-2, #4a5563)",
                      marginBottom: "0.35rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    <Sparkles size={11} color="#0284c7" />
                    <span>COGNITIVE PIPELINE OPERATIONS</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "11.5px", color: "var(--ink, #16212e)" }}>
                    {currentStepData.cognitiveOperations.map((op, i) => (
                      <li key={i} style={{ marginBottom: "2px", lineHeight: 1.4 }}>
                        {op}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Nodes & Bound Tools */}
                <div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontWeight: 600,
                      fontSize: "10.5px",
                      color: "var(--ink-2, #4a5563)",
                      marginBottom: "0.35rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    <Layers size={11} color="#16a34a" />
                    <span>ACTIVE NODES & BOUND TOOLS</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.45rem" }}>
                    {currentStepData.nodeIds.map((nid) => {
                      const nodeObj = NEURAL_NODES.find((n) => n.id === nid);
                      if (!nodeObj) return null;
                      return (
                        <button
                          key={nid}
                          type="button"
                          onClick={() => setSelectedNodeId(nid)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            padding: "2px 7px",
                            borderRadius: "3px",
                            backgroundColor: selectedNodeId === nid ? "#0284c7" : "var(--paper-sunk, #eef0ec)",
                            color: selectedNodeId === nid ? "#ffffff" : "var(--ink, #16212e)",
                            border: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.12))",
                            fontSize: "10.5px",
                            cursor: "pointer",
                            fontFamily: "'IBM Plex Mono', monospace",
                          }}
                        >
                          <PixelAgentIcon type={nodeObj.type} status={nodeStates[nid]?.status} size={12} />
                          <span>{nodeObj.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
                    <span style={{ fontSize: "10.5px", color: "var(--graphite, #7a838f)" }}>Tools:</span>
                    {currentStepData.tools.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "10px",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          backgroundColor: t.includes("tavily") ? "#e0f2fe" : "var(--paper-sunk, #eef0ec)",
                          color: t.includes("tavily") ? "#0369a1" : "var(--ink-2, #4a5563)",
                          border: t.includes("tavily") ? "1px solid #7dd3fc" : "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                          fontWeight: t.includes("tavily") ? 600 : 400,
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Input -> Output Pipeline */}
                <div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontWeight: 600,
                      fontSize: "10.5px",
                      color: "var(--ink-2, #4a5563)",
                      marginBottom: "0.35rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    <ArrowRight size={11} color="#0284c7" />
                    <span>INPUT → DELIVERABLE</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--ink-2, #4a5563)", lineHeight: 1.45 }}>
                    <div style={{ marginBottom: "3px" }}>
                      <strong style={{ color: "var(--graphite, #7a838f)" }}>Input: </strong>
                      <span>{currentStepData.inputData}</span>
                    </div>
                    <div>
                      <strong style={{ color: "var(--tick-deep, #13654a)" }}>Deliverable: </strong>
                      <span style={{ color: "var(--ink, #16212e)" }}>{currentStepData.outputDeliverable}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Interactive 5-Step Process Summary Ribbon when in "ALL NODES" view */}
          {activeStep === "all" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "0.5rem",
                padding: "0.65rem 0.85rem",
                backgroundColor: "var(--paper-sunk, #eef0ec)",
                borderTop: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                fontSize: "11px",
              }}
            >
              {MODEL_PROCESS_STEPS.map((s) => (
                <div
                  key={s.step}
                  onClick={() => setActiveStep(s.step)}
                  style={{
                    backgroundColor: "#ffffff",
                    borderRadius: "4px",
                    padding: "0.45rem 0.6rem",
                    border: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                    cursor: "pointer",
                    transition: "transform 0.1s ease, border-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#0284c7";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--rule-soft, rgba(22, 33, 46, 0.08))";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "2px" }}>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "9px",
                        fontWeight: 700,
                        backgroundColor: "#0284c7",
                        color: "#ffffff",
                        padding: "0 4px",
                        borderRadius: "2px",
                      }}
                    >
                      STEP {s.step}
                    </span>
                    <strong style={{ fontSize: "11px", color: "var(--ink, #16212e)" }}>{s.title}</strong>
                  </div>
                  <div style={{ color: "var(--graphite, #7a838f)", fontSize: "10px", lineHeight: 1.3 }}>
                    {s.outputDeliverable.slice(0, 50)}...
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Selected / Hovered Node HUD Drawer */}
          {selectedNode && (
            <div
              style={{
                padding: "0.65rem 0.85rem",
                backgroundColor: "var(--sheet, #ffffff)",
                borderTop: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                fontSize: "12px",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <PixelAgentIcon type={selectedNode.type} status={selectedState?.status} size={20} />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <strong style={{ color: "var(--ink, #16212e)" }}>{selectedNode.name}</strong>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: "10px",
                        color: "var(--tick-deep, #13654a)",
                        backgroundColor: "var(--tick-wash, #e8f3ed)",
                        padding: "1px 5px",
                        borderRadius: "3px",
                      }}
                    >
                      {selectedNode.layerName.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ color: "var(--ink-2, #4a5563)", fontSize: "11px", marginTop: "2px" }}>
                    {selectedNode.description}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "11px", color: "var(--graphite, #7a838f)" }}>Bound Tools:</span>
                {selectedNode.tools.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "10px",
                      padding: "1px 5px",
                      borderRadius: "3px",
                      backgroundColor: "var(--paper-sunk, #eef0ec)",
                      color: "var(--ink-2, #4a5563)",
                      border: "1px solid var(--rule-soft, rgba(22, 33, 46, 0.08))",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
