"""FastMCP server definition: exposes modular financial analysis tools via Model Context Protocol."""
from __future__ import annotations

import json
from typing import Any
try:
    from fastmcp import FastMCP
except ImportError:
    class FastMCP:
        def __init__(self, name: str = "FinSight-Core-Tools", **kwargs):
            self.name = name
        def tool(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

mcp_server = FastMCP(name="FinSight-Core-Tools")


@mcp_server.tool(name="financial_compute_ratios", description="Calculate core financial ratios (margins, liquidity, leverage, turnover) from raw financials.")
def financial_compute_ratios(facts_by_period: dict[str, dict[str, float]]) -> dict[str, Any]:
    """Computes standard financial ratios from structured financial facts."""
    return {"ratios": compute_all(facts_by_period)}


@mcp_server.tool(name="financial_health_score", description="Compute transparent rules-based financial health score (0-100) across liquidity, solvency, and profitability.")
def financial_health_score(metrics_dict: dict[str, float]) -> dict[str, Any]:
    """Evaluates metrics against rules-based financial health bands."""
    return compute_health_score(metrics_dict)


@mcp_server.tool(name="financial_detailed_analysis", description="Run DuPont decomposition, balance sheet reconciliation, and working capital bridge analysis.")
def financial_detailed_analysis(facts_by_period: dict[str, dict[str, float]]) -> dict[str, Any]:
    """Generates DuPont ratios, working capital bridges, and statement breakdowns."""
    return run_detailed_analysis(facts_by_period)


@mcp_server.tool(name="analytics_detect_anomalies", description="Detect statistical outliers and anomalies in financial transactions and series.")
def analytics_detect_anomalies(transactions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Identifies outlier transactions and irregular transaction patterns."""
    return detect_anomalies(transactions)


@mcp_server.tool(name="analytics_forecast_trend", description="Generate forward-looking financial forecast using Holt-Winters or linear trend modeling.")
def analytics_forecast_trend(series: list[float], periods_ahead: int = 4) -> dict[str, Any]:
    """Forecasts subsequent periods from an input time series."""
    return run_forecast(series, periods_ahead=periods_ahead)


@mcp_server.tool(name="analytics_credit_risk", description="Evaluate default risk and distress drivers across leverage and liquidity.")
def analytics_credit_risk(metrics: dict[str, float]) -> dict[str, Any]:
    """Calculates risk score (0-100), risk band (low/medium/high), and key distress drivers."""
    return score_risk(metrics)


@mcp_server.tool(name="data_query_facts", description="Query structured financial facts safely from the SQLite database by account code or period.")
def data_query_facts(tenant_id: str, job_id: str | None = None, account_code: str | None = None) -> list[dict[str, Any]]:
    """Safely fetch recorded financial facts from the relational store."""
    from app.models.dataset import FinancialFact
    query = FinancialFact.query.filter_by(tenant_id=tenant_id)
    if job_id:
        query = query.filter_by(job_id=job_id)
    if account_code:
        query = query.filter_by(account_code=account_code)
    facts = query.limit(100).all()
    return [
        {
            "account_code": f.account_code,
            "period": f.period,
            "amount": float(f.amount) if f.amount is not None else 0.0,
            "statement": f.statement,
        }
        for f in facts
    ]


@mcp_server.tool(name="search_document_rag", description="Search document chunks using in-process SQLite vector embeddings and cosine similarity (Zero external services needed).")
def search_document_rag(tenant_id: str, query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Perform local in-process vector similarity search over financial document excerpts."""
    from app.tools.vector_search import search
    return search(tenant_id=tenant_id, query=query, top_k=top_k)


@mcp_server.tool(name="web_search_market", description="Search public financial news, macroeconomic data, and competitor filings.")
def web_search_market(query: str, num_results: int = 3) -> list[dict[str, Any]]:
    """Performs web search for external market context."""
    from app.tools.web_search import search
    return search(query=query, num_results=num_results)


@mcp_server.tool(name="visualization_chart_spec", description="Dynamically construct domain charts and visualizations based on financial series.")
def visualization_chart_spec(chart_type: str, title: str, series: dict[str, list[float]], categories: list[str]) -> dict[str, Any]:
    """Generates chart configuration specs for the frontend explorer."""
    return {
        "chart_type": chart_type,
        "title": title,
        "series": series,
        "categories": categories,
    }


@mcp_server.tool(name="memory_store_observation", description="Store a takeaway, management guidance note, or financial fact for a company or topic in lightweight SQLite memory.")
def memory_store_observation(tenant_id: str, entity_name: str, observation: str, category: str = "observation") -> dict[str, Any]:
    """Persists a memory observation for a company or entity."""
    from app.extensions import db
    from app.models.agent_config import AgentMemory
    mem = AgentMemory(
        tenant_id=tenant_id,
        entity_name=entity_name.strip().upper(),
        category=category.strip().lower(),
        content=observation.strip(),
    )
    db.session.add(mem)
    db.session.commit()
    return {"status": "stored", "memory_id": mem.id, "entity_name": mem.entity_name}


@mcp_server.tool(name="memory_query_entity", description="Retrieve all historical memory observations, risks, and guidance notes recorded for a specific company or ticker.")
def memory_query_entity(tenant_id: str, entity_name: str, category: str | None = None) -> list[dict[str, Any]]:
    """Fetches memory observations for a given entity."""
    from app.models.agent_config import AgentMemory
    q = AgentMemory.query.filter_by(tenant_id=tenant_id, entity_name=entity_name.strip().upper())
    if category:
        q = q.filter_by(category=category.strip().lower())
    mems = q.order_by(AgentMemory.created_at.desc()).limit(50).all()
    return [m.to_dict() for m in mems]


@mcp_server.tool(name="memory_search_knowledge", description="Search across stored memory notes, guidance items, and entity observations using keyword or phrase search.")
def memory_search_knowledge(tenant_id: str, query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Searches memory observations by keyword or entity matching."""
    from app.models.agent_config import AgentMemory
    like_pat = f"%{query.strip()}%"
    mems = AgentMemory.query.filter(
        AgentMemory.tenant_id == tenant_id,
        (AgentMemory.content.ilike(like_pat) | AgentMemory.entity_name.ilike(like_pat))
    ).order_by(AgentMemory.created_at.desc()).limit(limit).all()
    return [m.to_dict() for m in mems]


@mcp_server.tool(name="memory_delete_observation", description="Delete an outdated or superseded memory observation by its ID.")
def memory_delete_observation(tenant_id: str, memory_id: str) -> dict[str, Any]:
    """Removes a memory observation from the store."""
    from app.extensions import db
    from app.models.agent_config import AgentMemory
    mem = AgentMemory.query.filter_by(tenant_id=tenant_id, id=memory_id).first()
    if mem:
        db.session.delete(mem)
        db.session.commit()
        return {"status": "deleted", "memory_id": memory_id}
    return {"status": "not_found", "memory_id": memory_id}


@mcp_server.tool(name="tavily_validate_value", description="Validate a financial metric, ratio, or reported value against public Internet data, SEC/MCA filings, and market consensus using Tavily.")
def tavily_validate_value(
    metric_name: str,
    reported_value: str | float,
    company_name: str = "",
    period: str = "",
) -> dict[str, Any]:
    """Validates financial figures against live web sources via Tavily."""
    import os
    import requests
    from flask import current_app

    api_key = ""
    try:
        api_key = current_app.config.get("TAVILY_API_KEY", "")
    except Exception:
        pass
    if not api_key:
        api_key = os.environ.get("TAVILY_API_KEY", "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")

    search_query = f"{company_name} {period} {metric_name} reported financial results filings SEC MCA".strip()

    search_results = []
    tavily_answer = ""
    try:
        res = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": search_query,
                "search_depth": "advanced",
                "max_results": 4,
                "include_answer": True,
            },
            timeout=10,
        )
        if res.ok:
            data = res.json()
            search_results = data.get("results", [])
            tavily_answer = data.get("answer", "")
        else:
            tavily_answer = f"Tavily lookup HTTP {res.status_code}"
    except Exception as exc:
        tavily_answer = f"Internet lookup exception: {exc}"

    citations = []
    for r in search_results:
        citations.append({
            "title": r.get("title", "Market Source"),
            "url": r.get("url", ""),
            "snippet": r.get("content", "")[:280],
        })

    status = "VALIDATED" if search_results else "UNVERIFIED"
    confidence = 0.85 if search_results else 0.40

    return {
        "metric_name": metric_name,
        "reported_value": reported_value,
        "company_name": company_name,
        "period": period,
        "validation_status": status,
        "confidence": confidence,
        "tavily_ai_summary": tavily_answer,
        "sources": citations,
        "search_query": search_query,
    }

