import pytest
from app.a2a.broker import a2a_broker
from app.a2a.protocol import A2ACapability, A2AMessage, A2AMessageType, A2AResponse
from app.mcp.toolbox import mcp_toolbox
from app.models.agent_config import AgentDefinition, MCPEndpoint


def test_fastmcp_tools_execution():
    """Verify core deterministic financial and risk tools execute cleanly via MCP toolbox."""
    # 1. Health score tool
    res = mcp_toolbox.call_tool("financial_health_score", {"metrics_dict": {"current_ratio": 1.8, "net_profit_margin": 0.12}})
    assert res.success
    assert "score" in res.content
    assert res.content["score"] > 0

    # 2. Credit risk tool
    risk_res = mcp_toolbox.call_tool(
        "analytics_credit_risk",
        {"metrics": {"debt_to_equity": 2.5, "current_ratio": 0.8, "interest_coverage": 1.2}},
    )
    assert risk_res.success
    assert "risk_score" in risk_res.content
    assert risk_res.content["risk_score"] > 0
    assert "band" in risk_res.content

    # 3. Anomaly detection tool
    sample_txns = [
        {"debit": 5000.0, "credit": 0.0, "narration": "Vendor Payment", "row_idx": 1},
        {"debit": 5100.0, "credit": 0.0, "narration": "Vendor Payment", "row_idx": 2},
        {"debit": 4900.0, "credit": 0.0, "narration": "Vendor Payment", "row_idx": 3},
        {"debit": 5050.0, "credit": 0.0, "narration": "Vendor Payment", "row_idx": 4},
        {"debit": 1500000.0, "credit": 0.0, "narration": "Cash withdrawal", "row_idx": 5},
    ]
    anomaly_res = mcp_toolbox.call_tool("analytics_detect_anomalies", {"transactions": sample_txns})
    assert anomaly_res.success
    assert isinstance(anomaly_res.content, list)
    assert len(anomaly_res.content) > 0


def test_a2a_broker_messaging_and_discovery(app):
    """Verify Agent-to-Agent message bus, routing, and skill-based discovery."""
    with app.app_context():
        # Register test agents
        cap_analyst = A2ACapability(
            agent_id="test_analyst",
            name="Test Analyst",
            role="Ratio Evaluator",
            skills=["ratio_calculation", "statement_analysis"],
        )
        cap_auditor = A2ACapability(
            agent_id="test_auditor",
            name="Test Auditor",
            role="Fraud Investigator",
            skills=["audit_verification", "anomaly_detection"],
        )

        def auditor_handler(msg: A2AMessage) -> A2AResponse:
            return A2AResponse(
                success=True,
                data={"verified": True, "auditor_notes": "All ratios align with footnotes."},
                summary="Verified without discrepancies.",
            )

        a2a_broker.register_agent("test_analyst", cap_analyst)
        a2a_broker.register_agent("test_auditor", cap_auditor, handler=auditor_handler)

        # Discovery test
        audit_agents = a2a_broker.discover_agents(skill="audit_verification")
        assert any(a.agent_id == "test_auditor" for a in audit_agents)

        # Message routing test
        msg = A2AMessage(
            conversation_id="conv_test_1",
            sender_agent="test_analyst",
            recipient_agent="test_auditor",
            message_type=A2AMessageType.REQUEST,
            intent="verify_metrics",
            payload={"ebitda": 50000},
        )
        resp = a2a_broker.send_message(msg)
        assert resp.success
        assert resp.data["verified"] is True
        assert "auditor_notes" in resp.data


def test_agent_studio_apis(client):
    """Test full CRUD on /api/agents and agent testing bench."""
    # 1. List agents
    res = client.get("/api/agents?full=true")
    assert res.status_code == 200
    data = res.get_json()
    assert "builtin" in data
    assert "custom" in data

    # 2. Create custom agent
    create_res = client.post(
        "/api/agents",
        json={
            "name": "ESG Compliance Reviewer",
            "role": "Sustainability & Governance Auditor",
            "description": "Reviews carbon emissions notes and governance disclosures.",
            "system_prompt": "You are the ESG Compliance Reviewer. Examine governance notes and ESG risks.",
            "skills": ["custom_task", "audit_verification"],
            "assigned_tools": ["search_document_rag", "web_search_market"],
            "model_tier": "default",
        },
    )
    assert create_res.status_code == 201
    created_agent = create_res.get_json()
    agent_id = created_agent["id"]
    assert created_agent["name"] == "ESG Compliance Reviewer"

    # 3. Test agent execution playground
    test_res = client.post(
        f"/api/agents/{agent_id}/test",
        json={"input": "Check disclosure notes for environmental liabilities."},
    )
    assert test_res.status_code == 200
    test_data = test_res.get_json()
    assert "response" in test_data
    assert "duration_ms" in test_data

    # 4. Update custom agent
    update_res = client.put(
        f"/api/agents/{agent_id}",
        json={"role": "Senior ESG & Carbon Auditor"},
    )
    assert update_res.status_code == 200
    assert update_res.get_json()["role"] == "Senior ESG & Carbon Auditor"

    # 5. Delete custom agent
    del_res = client.delete(f"/api/agents/{agent_id}")
    assert del_res.status_code == 200
    assert del_res.get_json()["success"] is True


def test_mcp_api_endpoints(client):
    """Test /api/mcp/tools and /api/mcp/endpoints."""
    # 1. Tools catalog
    tools_res = client.get("/api/mcp/tools")
    assert tools_res.status_code == 200
    t_data = tools_res.get_json()
    assert "tools" in t_data
    assert t_data["count"] > 0
    assert any(t["name"] == "financial_health_score" for t in t_data["tools"])

    # 2. Endpoints listing
    ep_res = client.get("/api/mcp/endpoints")
    assert ep_res.status_code == 200
    endpoints = ep_res.get_json()["endpoints"]
    assert any(e["id"] == "internal" for e in endpoints)

    # 3. Direct tool execution via API
    call_res = client.post(
        "/api/mcp/tools/call",
        json={
            "name": "financial_health_score",
            "arguments": {"metrics_dict": {"current_ratio": 2.2, "debt_to_equity": 0.4}},
        },
    )
    assert call_res.status_code == 200
    call_data = call_res.get_json()
    assert call_data["success"] is True
    assert call_data["content"]["score"] > 0
