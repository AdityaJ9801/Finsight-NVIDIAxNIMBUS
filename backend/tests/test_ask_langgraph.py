"""Tests for the LangChain & LangGraph ASK Chatbot Agent and Execution Harness."""
import pytest
from app.agents.delivery.ask_langgraph import AskHarness, get_ask_harness
from app.utils.default_tenant import ensure_default_context
from tests.test_assistant_endpoint import _make_validated_job


def test_ask_harness_capabilities(app):
    with app.app_context():
        harness = get_ask_harness()
        agents = harness.list_available_agents()
        tools = harness.list_available_tools()

        assert len(agents) == 16, f"Expected 16 agents, got {len(agents)}"
        agent_names = {a["name"] for a in agents}
        assert "ratio" in agent_names
        assert "risk" in agent_names
        assert "detailed_analytics" in agent_names
        assert "verification_advisor" in agent_names
        assert "report_writer" in agent_names

        assert len(tools) >= 10, f"Expected at least 10 tools, got {len(tools)}"
        tool_names = {t["name"] for t in tools}
        assert "financial_detailed_analysis" in tool_names
        assert "financial_health_score" in tool_names
        assert "analytics_detect_anomalies" in tool_names


def test_ask_harness_conversational(app):
    with app.app_context():
        ensure_default_context()
        harness = get_ask_harness()
        res = harness.run("t_1", "dv_1", "thanks!")
        assert res["route"] == "report_lookup"
        assert "helpful" in res["answer"].lower()
        assert res["rendered_output"]["format"] == "narrative"


def test_ask_harness_agent_dispatch(app):
    job_id = _make_validated_job(app)
    with app.app_context():
        from app.models.job import Job
        from app.extensions import db
        job = db.session.get(Job, job_id)
        harness = get_ask_harness()

        res = harness.run(job.tenant_id, job.dataset_version_id, "@risk Scan for red flags and anomalies", job_id=job.id)
        assert res["route"] == "agent_dispatch"
        assert res["tool_used"] == "agent_risk"
        assert "agent" in res["rendered_output"]
        assert res["rendered_output"]["agent"]["agent_name"] == "risk"
        assert res["rendered_output"]["agent"]["stage"] == "analysis"


def test_ask_harness_mcp_dupont_table(app):
    job_id = _make_validated_job(app)
    with app.app_context():
        from app.models.job import Job
        from app.extensions import db
        job = db.session.get(Job, job_id)
        harness = get_ask_harness()

        res = harness.run(
            job.tenant_id,
            job.dataset_version_id,
            "Run DuPont 3-way ROE decomposition in a table",
            preferred_format="table",
            job_id=job.id,
        )
        assert res["tool_used"] == "financial_detailed_analysis"
        assert "table" in res["rendered_output"]
        table = res["rendered_output"]["table"]
        assert "columns" in table
        assert "rows" in table
        assert "ROE" in table["columns"]


def test_ask_harness_cfo_diagnostic(app):
    job_id = _make_validated_job(app)
    with app.app_context():
        from app.models.job import Job
        from app.extensions import db
        job = db.session.get(Job, job_id)
        harness = get_ask_harness()

        res = harness.run(
            job.tenant_id,
            job.dataset_version_id,
            "Diagnose why PAT dropped",
            preferred_format="diagnostic",
            job_id=job.id,
        )
        assert res["route"] == "cfo_diagnostic"
        assert res["tool_used"] == "cfo_diagnostic_trace"
        assert "diagnostic" in res["rendered_output"]
        diag = res["rendered_output"]["diagnostic"]
        assert "drivers" in diag
        assert diag["direction"] == "decline"


def test_qa_api_capabilities_endpoint(client, app):
    res = client.get("/api/qa/capabilities")
    assert res.status_code == 200
    data = res.get_json()
    assert "agents" in data
    assert "tools" in data
    assert len(data["agents"]) == 16


def test_qa_api_ask_with_format(client, app):
    job_id = _make_validated_job(app)
    with app.app_context():
        res = client.post("/api/qa", json={
            "job_id": job_id,
            "question": "Show DuPont decomposition in a table",
            "format": "table",
        })
        assert res.status_code == 200
        data = res.get_json()
        assert "answer" in data
        assert "rendered_output" in data
        assert data["rendered_output"]["format"] == "table"
        assert "table" in data["rendered_output"]


@pytest.mark.parametrize("web_lookup", ["skipped", "success", "failure"])
def test_knowledge_qa_web_validation_paths(app, monkeypatch, web_lookup):
    from app.agents.delivery import ask_langgraph

    calls = []

    def validate(**kwargs):
        calls.append(kwargs)
        if web_lookup == "failure":
            raise RuntimeError("Web lookup unavailable")
        return {"validation_status": "verified", "sources": []}

    class Gateway:
        def complete(self, *args, **kwargs):
            return "Financial analysis response."

    monkeypatch.setattr(ask_langgraph, "tavily_validate_value", validate)
    monkeypatch.setattr(ask_langgraph, "build_facts", lambda *args: [])
    monkeypatch.setattr(ask_langgraph, "resolve_placeholders", lambda text, _: (text, []))
    monkeypatch.setattr(ask_langgraph, "get_llm_gateway", lambda: Gateway())
    with app.app_context():
        result = ask_langgraph.knowledge_qa_node({
            "tenant_id": "t_1",
            "dataset_version_id": "dv_1",
            "job_id": None,
            "question": "Summarize revenue",
            "search_plan": {
                "selected_tools": ["data_query_facts"],
                "metric_codes": ["revenue"],
                "requires_web_validation": web_lookup != "skipped",
            },
        })

    assert result["answer"] == "Financial analysis response."
    assert len(calls) == (0 if web_lookup == "skipped" else 1)
    web_steps = [step for step in result["search_plan"]["a2a_dialogue"]
                 if step["tool"] == "tavily_validate_value"]
    assert bool(web_steps) == (web_lookup == "success")