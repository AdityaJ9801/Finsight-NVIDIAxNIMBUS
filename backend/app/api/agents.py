"""API endpoints for managing multi-agent configurations, custom agents, skills, and A2A logs."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request

from app.a2a.broker import a2a_broker
from app.a2a.protocol import A2ACapability, A2AMessage, A2AMessageType
from app.agents import registry as agent_registry
from app.extensions import db
from app.models.agent_config import AgentDefinition, A2AMessageLog
from app.utils.ids import new_id

bp = Blueprint("agents", __name__)

AVAILABLE_SKILLS = [
    {"id": "statement_analysis", "name": "Statement Analysis", "category": "Core", "description": "Decomposes P&L, balance sheet, and cash flows."},
    {"id": "ratio_calculation", "name": "Financial Ratios", "category": "Analysis", "description": "Computes margins, liquidity, leverage, and turnover."},
    {"id": "health_scoring", "name": "Health Scoring", "category": "Analysis", "description": "Calculates composite 0-100 financial health scores."},
    {"id": "dupont_decomposition", "name": "DuPont Decomposition", "category": "Analysis", "description": "Breaks down ROE across margin, turnover, and leverage."},
    {"id": "working_capital_bridge", "name": "Working Capital Bridge", "category": "Analysis", "description": "Traces cash conversion cycles and working capital changes."},
    {"id": "anomaly_detection", "name": "Anomaly Detection", "category": "Auditing", "description": "Flags statistical outliers and jumps in financial series."},
    {"id": "trend_forecasting", "name": "Trend Forecasting", "category": "Projection", "description": "Models forward financial trajectory using trend regression."},
    {"id": "credit_risk_scoring", "name": "Credit & Distress Risk", "category": "Risk", "description": "Calculates Altman Z-score and Piotroski F-score."},
    {"id": "audit_verification", "name": "Audit & Fact Verification", "category": "Auditing", "description": "Validates report claims against source facts."},
    {"id": "covenant_monitoring", "name": "Debt Covenant Monitoring", "category": "Risk", "description": "Monitors debt limits, interest coverage, and ratios."},
    {"id": "tax_compliance", "name": "Tax & Provision Analysis", "category": "Tax", "description": "Inspects effective tax rates and provision notes."},
    {"id": "market_research", "name": "Market & Competitor Context", "category": "Research", "description": "Uses web search to ground corporate financials."},
    {"id": "custom_task", "name": "Custom Analytical Task", "category": "Custom", "description": "Performs specialized prompt-driven reasoning."},
]


@bp.get("")
def list_agents():
    """List both system built-in agents and user-created custom agents."""
    # 1. System built-in agents from agent_registry
    builtin_list = []
    for a in agent_registry.AGENTS:
        pub = a.to_public_dict()
        pub["is_builtin"] = True
        pub["is_active"] = True
        pub["skills"] = [pub.get("stage", "general"), "audit_verification" if "verifier" in a.name else "statement_analysis"]
        pub["system_prompt"] = f"You are {a.label}, a specialized financial agent responsible for: {a.description}."
        pub["assigned_tools"] = ["mcp::core"]
        pub["model_tier"] = "default"
        builtin_list.append(pub)

    # 2. Custom agents from DB
    custom_records = []
    try:
        defs = AgentDefinition.query.order_by(AgentDefinition.created_at.desc()).all()
        custom_records = [d.to_dict() for d in defs]
    except Exception:
        pass

    all_agents = builtin_list + custom_records
    if request.args.get("full") == "true":
        return jsonify({"builtin": builtin_list, "custom": custom_records, "all": all_agents})

    return jsonify(all_agents)


@bp.post("")
def create_agent():
    """Create a new custom agent with custom prompt, skills, and MCP tools."""
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    role = (data.get("role") or "").strip()
    system_prompt = (data.get("system_prompt") or "").strip()

    if not name or not role or not system_prompt:
        return jsonify({"error": "name, role, and system_prompt are required."}), 400

    agent_id = data.get("id") or f"agent_{name.lower().replace(' ', '_')}_{int(time.time()) % 10000}"
    # Check uniqueness
    if db.session.get(AgentDefinition, agent_id):
        agent_id = new_id(f"agent_{name.lower().replace(' ', '_')[:12]}_")

    agent = AgentDefinition(
        id=agent_id,
        name=name,
        role=role,
        description=data.get("description", ""),
        system_prompt=system_prompt,
        skills=data.get("skills", ["custom_task"]),
        assigned_tools=data.get("assigned_tools", []),
        model_tier=data.get("model_tier", "default"),
        allowed_peers=data.get("allowed_peers", ["*"]),
        is_builtin=False,
        is_active=data.get("is_active", True),
    )
    db.session.add(agent)
    db.session.commit()

    # Register with A2A broker capability cache
    a2a_broker.register_agent(
        agent.id,
        A2ACapability(
            agent_id=agent.id,
            name=agent.name,
            role=agent.role,
            skills=agent.skills,
            allowed_tools=agent.assigned_tools,
            description=agent.description,
        ),
    )

    return jsonify(agent.to_dict()), 201


@bp.get("/<agent_id>")
def get_agent(agent_id: str):
    agent = db.session.get(AgentDefinition, agent_id)
    if not agent:
        return jsonify({"error": f"Agent '{agent_id}' not found."}), 404
    return jsonify(agent.to_dict())


@bp.put("/<agent_id>")
def update_agent(agent_id: str):
    agent = db.session.get(AgentDefinition, agent_id)
    if not agent:
        return jsonify({"error": f"Agent '{agent_id}' not found."}), 404

    data = request.get_json() or {}
    if "name" in data:
        agent.name = data["name"].strip()
    if "role" in data:
        agent.role = data["role"].strip()
    if "description" in data:
        agent.description = data["description"]
    if "system_prompt" in data:
        agent.system_prompt = data["system_prompt"]
    if "skills" in data:
        agent.skills = data["skills"]
    if "assigned_tools" in data:
        agent.assigned_tools = data["assigned_tools"]
    if "model_tier" in data:
        agent.model_tier = data["model_tier"]
    if "allowed_peers" in data:
        agent.allowed_peers = data["allowed_peers"]
    if "is_active" in data:
        agent.is_active = bool(data["is_active"])

    agent.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    # Refresh capability in broker
    a2a_broker.register_agent(
        agent.id,
        A2ACapability(
            agent_id=agent.id,
            name=agent.name,
            role=agent.role,
            skills=agent.skills,
            allowed_tools=agent.assigned_tools,
            description=agent.description,
        ),
    )

    return jsonify(agent.to_dict())


@bp.delete("/<agent_id>")
def delete_agent(agent_id: str):
    agent = db.session.get(AgentDefinition, agent_id)
    if not agent:
        return jsonify({"error": f"Agent '{agent_id}' not found."}), 404
    if agent.is_builtin:
        return jsonify({"error": "Cannot delete built-in system agents."}), 403

    db.session.delete(agent)
    db.session.commit()
    a2a_broker.unregister_agent(agent_id)
    return jsonify({"success": True, "message": f"Agent '{agent_id}' deleted."})


@bp.get("/skills")
def list_skills():
    """Return catalog of selectable skills for agents."""
    return jsonify(AVAILABLE_SKILLS)


@bp.post("/<agent_id>/test")
def test_agent(agent_id: str):
    """Test run an agent with sample prompt and context; returns output, tools invoked, and timing."""
    data = request.get_json() or {}
    sample_input = data.get("input") or "Perform an initial assessment of solvency and liquidity ratios."
    override_prompt = data.get("system_prompt")

    agent = db.session.get(AgentDefinition, agent_id)
    if not agent and not override_prompt:
        # Check built-in agent
        matched_builtin = next((a for a in agent_registry.AGENTS if a.name == agent_id), None)
        if not matched_builtin:
            return jsonify({"error": f"Agent '{agent_id}' not found."}), 404
        system_prompt = f"You are {matched_builtin.label}, a financial AI agent. {matched_builtin.description}"
        model_tier = "default"
        assigned_tools = ["financial_compute_ratios", "financial_health_score"]
    else:
        system_prompt = override_prompt or agent.system_prompt
        model_tier = agent.model_tier if agent else "default"
        assigned_tools = agent.assigned_tools if agent else []

    from app.llm_gateway import get_llm_gateway
    from app.mcp.toolbox import mcp_toolbox

    started = time.monotonic()
    llm = get_llm_gateway()

    # Discover assigned MCP tools
    tools_desc = []
    if assigned_tools:
        all_tools = mcp_toolbox.list_tools()
        tools_desc = [t for t in all_tools if t["name"] in assigned_tools]

    tool_guide = ""
    if tools_desc:
        tool_guide = "\n\nYou have access to the following MCP tools:\n" + "\n".join(
            [f"- {t['name']}: {t['description']}" for t in tools_desc]
        )

    messages = [
        {"role": "system", "content": system_prompt + tool_guide},
        {"role": "user", "content": sample_input},
    ]

    try:
        response = llm.complete(messages, tier=model_tier)
        duration_ms = (time.monotonic() - started) * 1000.0
        response_text = getattr(response, "content", str(response))
        tokens_in = getattr(response, "input_tokens", len(sample_input.split()))
        tokens_out = getattr(response, "output_tokens", len(response_text.split()))
        return jsonify({
            "agent_id": agent_id,
            "response": response_text,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "duration_ms": round(duration_ms, 2),
            "assigned_tools_count": len(tools_desc),
        })
    except Exception as exc:
        duration_ms = (time.monotonic() - started) * 1000.0
        return jsonify({
            "error": str(exc),
            "duration_ms": round(duration_ms, 2),
        }), 500


@bp.get("/a2a/messages")
def get_a2a_messages():
    """Query Agent-to-Agent message exchange log for a job or conversation."""
    job_id = request.args.get("job_id")
    conv_id = request.args.get("conversation_id")
    limit = min(int(request.args.get("limit", 50)), 200)

    query = A2AMessageLog.query
    if job_id:
        query = query.filter_by(job_id=job_id)
    if conv_id:
        query = query.filter_by(conversation_id=conv_id)

    records = query.order_by(A2AMessageLog.created_at.asc()).limit(limit).all()
    return jsonify([r.to_dict() for r in records])
