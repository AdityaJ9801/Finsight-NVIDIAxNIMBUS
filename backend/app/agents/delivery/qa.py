"""Interactive QA agent (design doc §6.9). Called synchronously from the API (not part of
the job DAG) since answers need to be fast. Routing is a real LLM call; the "text-to-SQL"
step is intentionally the simplified {view, filters} form from tools/sql_tool.py rather
than free-form SQL generation -- see that module's docstring for why.
"""
from __future__ import annotations

import re

from app.agents.base import AgentResult, ArtifactRef, Status, TaskSpec, WorkerAgent
from app.agents.schemas import QAAnswerResult, RouteDecision
from app.extensions import db
from app.llm_gateway import prompts
from app.llm_gateway.prompt_utils import embed_json
from app.models.dataset import DatasetVersion
from app.models.document import Document
from app.domain.financial_intelligence import build_cfo_diagnostic_trace, resolve_metric_tree
from app.models.finding import Finding
from app.tools.calc.metrics import REGISTRY
from app.domain.metric_facts import build_facts, match_metrics
from app.orchestrator import blackboard
from app.tools.report_render import resolve_placeholders

_CONCERN_WORDS = re.compile(r"\b(risk|concern|worr|issue|problem|red flag|weak|lender|credit|flag|finding|anomal)", re.I)
_SEVERITY_RANK = {"error": 0, "warn": 1, "info": 2}

_CONVERSATIONAL_WORDS = {
    "ok", "okay", "thanks", "thank you", "great", "got it", "understood",
    "yes", "sure", "cool", "noted", "continue", "hello", "hi", "hey",
}


class QAAgent(WorkerAgent):
    name = "qa"
    allowed_tools = ["sql.query_readonly", "vector.search", "web.search"]

    def _synthesize_with_llm(self, question: str, data_summary: str) -> str:
        """Invokes the AI LLM model to interpret and synthesize financial tool outputs."""
        try:
            prompt = [
                {
                    "role": "system",
                    "content": (
                        "You are a senior corporate finance director and Virtual CFO. Interpret the structured "
                        "financial analysis data below. Provide concise, high-impact executive insights, highlighting "
                        "core drivers, liquidity/solvency implications, and strategic considerations."
                    ),
                },
                {
                    "role": "user",
                    "content": f"User Query: {question}\n\nStructured Findings & Data:\n{data_summary}\n\nProvide executive financial commentary interpreting these figures.",
                },
            ]
            res = self.call_llm(prompt, schema=None, tier="fast", max_tokens=600)
            if res and isinstance(res, str) and len(res.strip()) > 20:
                return res.strip()
        except Exception:
            pass
        return ""

    def answer(
        self,
        tenant_id: str,
        dataset_version_id: str,
        question: str,
        history: list[dict] | None = None,
    ) -> dict:
        q_clean = question.strip().lower().rstrip(".!?,")
        if q_clean in _CONVERSATIONAL_WORDS:
            return {
                "answer": (
                    "Glad that was helpful! Let me know if you would like more details on specific "
                    "financial metrics, want to explore the visual charts, or need to re-run any "
                    "analysis module with new assumptions."
                ),
                "citations": [],
                "route": "report_lookup",
            }

        dataset_version = db.session.get(DatasetVersion, dataset_version_id)
        job_id = dataset_version.job_id if dataset_version else None

        # 1. Instant Chart Delivery Short-Circuit (<30ms)
        from app.domain.chat_intent import is_chart_request, is_action_request
        from app.domain.dynamic_chart_builder import generate_chart_for_prompt

        if job_id and is_chart_request(question):
            try:
                gen_chart = generate_chart_for_prompt(job_id, question)
                if gen_chart:
                    title = gen_chart.get("title", "Financial Chart")
                    takeaway = gen_chart.get("takeaway", "")
                    caption = gen_chart.get("caption", "")
                    answer_body = f"**{title}**\n\n{takeaway}\n\n*Key Details:* {caption}" if takeaway else f"Generated dynamic chart: **{title}**.\n\n{caption}"
                    return {
                        "answer": answer_body,
                        "citations": [gen_chart.get("chart_id", "dynamic_chart")],
                        "route": "chart_lookup",
                        "chart": {
                            "chart_id": gen_chart.get("chart_id"),
                            "title": gen_chart.get("title"),
                            "caption": gen_chart.get("caption", ""),
                            "takeaway": gen_chart.get("takeaway", ""),
                            "png_base64": gen_chart.get("png_base64"),
                            "section_key": gen_chart.get("section_key"),
                        },
                    }
            except Exception:
                pass

        # 2. Specialized MCP Tool Dispatch (Deterministic & Statistical Financial Engines with AI Synthesis)
        # 2a. DuPont 3-Way / 5-Way Decomposition & Profit Bridge
        if any(w in q_clean for w in ("dupont", "roe breakdown", "return on equity breakdown", "roe decomposition", "dupont analysis")):
            from app.domain.facts import load_facts_by_period
            from app.tools.calc.detailed_analysis import dupont
            facts_by_period = load_facts_by_period(dataset_version_id)
            if facts_by_period:
                dp = dupont(facts_by_period)
                if dp:
                    lines = [
                        "### 🔬 DuPont 3-Way ROE Decomposition Analysis",
                        "",
                        "*Formula: $\\text{ROE} = \\text{Net Profit Margin} \\times \\text{Asset Turnover} \\times \\text{Equity Multiplier}$*",
                        "",
                        "| Period | Net Profit Margin | Asset Turnover | Financial Leverage | ROE |",
                        "| :--- | :---: | :---: | :---: | :---: |",
                    ]
                    for row in dp:
                        p_str = row.get("period", "")
                        nm = f"{row.get('net_margin', 0) * 100:.2f}%" if row.get("net_margin") is not None else "N/A"
                        at = f"{row.get('asset_turnover', 0):.2f}x" if row.get("asset_turnover") is not None else "N/A"
                        em = f"{row.get('equity_multiplier', 0):.2f}x" if row.get("equity_multiplier") is not None else "N/A"
                        roe_val = f"{row.get('roe', 0) * 100:.2f}%" if row.get("roe") is not None else "N/A"
                        lines.append(f"| {p_str} | {nm} | {at} | {em} | **{roe_val}** |")
                    latest = dp[-1]
                    lines.append("")
                    lines.append(
                        f"**Key Driver:** In the latest period ({latest.get('period')}), ROE closed at "
                        f"**{latest.get('roe', 0)*100:.2f}%**, supported by an asset turnover of "
                        f"**{latest.get('asset_turnover', 0):.2f}x** and leverage multiplier of **{latest.get('equity_multiplier', 0):.2f}x**."
                    )
                    ai_insights = self._synthesize_with_llm(question, "\n".join(lines))
                    if ai_insights:
                        lines.append("")
                        lines.append("### 🧠 AI Financial Analysis")
                        lines.append(ai_insights)
                    return {
                        "answer": "\n".join(lines),
                        "citations": ["dupont_decomposition", "financial_detailed_analysis"],
                        "route": "dupont",
                        "tool_used": "financial_detailed_analysis",
                    }

        # 2b. Financial Health Score (0-100 rules-based evaluation with AI Synthesis)
        if any(w in q_clean for w in ("health score", "financial rating", "overall health", "health rating", "solvency rating")):
            from app.models.metric import Metric
            from app.tools.calc.health_score import compute_health_score
            metrics = Metric.query.filter_by(dataset_version=dataset_version_id).all()
            metrics_dict = {m.metric_code: float(m.value) for m in metrics if m.value is not None}
            hs = compute_health_score(metrics_dict)
            if hs:
                score = hs.get("score", 0)
                rating = str(hs.get("rating", "Moderate")).upper()
                breakdown = hs.get("breakdown", [])
                lines = [
                    f"### 🛡️ FinSight Financial Health Score: **{score}/100** ({rating})",
                    "",
                    f"Rules-based composite financial health rating is **{rating}** across liquidity, solvency, and margins.",
                    "",
                    "| Component Metric | Points | Max Weight | Assessment |",
                    "| :--- | :---: | :---: | :---: |",
                ]
                for b in breakdown[:8]:
                    pts = b.get("points", 0)
                    wt = b.get("weight", 0)
                    status_icon = "✓ Strong" if pts >= wt * 0.7 else ("⚠️ Moderate" if pts > 0 else "✕ Weak")
                    lines.append(f"| {b.get('metric_code', '').replace('_', ' ').title()} | {pts} | {wt} | {status_icon} |")
                ai_insights = self._synthesize_with_llm(question, "\n".join(lines))
                if ai_insights:
                    lines.append("")
                    lines.append("### 🧠 AI Financial Analysis")
                    lines.append(ai_insights)
                return {
                    "answer": "\n".join(lines),
                    "citations": ["health_score", "financial_health_score"],
                    "route": "health_score",
                    "tool_used": "financial_health_score",
                }

        # 2c. Statistical Anomaly & Outlier Scan (Isolation Forest & Z-Score with AI Synthesis)
        if any(w in q_clean for w in ("anomal", "outlier", "irregular transaction", "suspicious transaction", "fraud", "irregularities")):
            from app.models.dataset import BankTransaction, FinancialFact
            from app.tools.ml.anomaly import detect_anomalies
            txns = BankTransaction.query.filter_by(dataset_version=dataset_version_id).limit(100).all()
            txn_dicts = [t.to_dict() for t in txns] if txns else []
            if not txn_dicts:
                facts = FinancialFact.query.filter_by(dataset_version=dataset_version_id).limit(60).all()
                txn_dicts = [{"date": str(f.period), "narration": f.account_code, "amount": float(f.amount or 0.0), "debit": float(f.amount or 0.0)} for f in facts]
            anomalies = detect_anomalies(txn_dicts)
            lines = [
                "### ⚠️ Statistical Anomaly & Outlier Scan",
                f"Scanned {len(txn_dicts)} transaction records using statistical z-scores and isolation boundaries.",
                "",
            ]
            if anomalies:
                lines.append(f"**Identified {len(anomalies)} irregular transactions / data points:**")
                lines.append("")
                lines.append("| Date / Period | Particulars / Account | Amount | Severity | Z-Score / Reason |")
                lines.append("| :--- | :--- | :---: | :---: | :--- |")
                for a in anomalies[:6]:
                    dt = a.get("date", "N/A")
                    narr = a.get("narration", a.get("account", "Transaction"))
                    amt = a.get("amount", 0)
                    sev = str(a.get("severity", "warning")).upper()
                    reason = a.get("reason") or f"z-score={float(a.get('z_score', 0)):.2f}"
                    lines.append(f"| {dt} | {narr} | {amt:,.2f} | **{sev}** | {reason} |")
            else:
                lines.append("✓ **No critical anomalies or severe outlier spikes detected.** Transactions conform within expected statistical distribution ranges.")
            ai_insights = self._synthesize_with_llm(question, "\n".join(lines))
            if ai_insights:
                lines.append("")
                lines.append("### 🧠 AI Forensic Analysis")
                lines.append(ai_insights)
            return {
                "answer": "\n".join(lines),
                "citations": ["anomaly_detector", "analytics_detect_anomalies"],
                "route": "anomalies",
                "tool_used": "analytics_detect_anomalies",
            }

        # 2d. Forward Forecast & Trend Projections (Holt-Winters with AI Synthesis)
        if any(w in q_clean for w in ("forecast", "projection", "predict next", "future revenue", "future profit")):
            from app.domain.facts import load_facts_by_period
            from app.tools.ml.forecast import run_forecast
            facts_by_period = load_facts_by_period(dataset_version_id)
            if facts_by_period:
                sorted_periods = sorted(facts_by_period.keys())
                rev_series = [facts_by_period[p].get("PL.REVENUE") or facts_by_period[p].get("BS.CA.CASH") or 0.0 for p in sorted_periods]
                rev_series = [float(v) for v in rev_series if v > 0]
                if len(rev_series) >= 2:
                    fc = run_forecast(rev_series, periods_ahead=4)
                    lines = [
                        "### 📈 Forward Trend Projection (Holt-Winters & Trend Modeling)",
                        f"Analyzed {len(rev_series)} historical periods. Modeled **4 forward periods**:",
                        "",
                        "| Projection Step | Forecasted Estimate | Lower Bound (80%) | Upper Bound (80%) |",
                        "| :--- | :---: | :---: | :---: |",
                    ]
                    for idx, val in enumerate(fc.get("forecast", [])):
                        lo = fc.get("lower_bound", [val * 0.9])[idx] if idx < len(fc.get("lower_bound", [])) else val * 0.9
                        hi = fc.get("upper_bound", [val * 1.1])[idx] if idx < len(fc.get("upper_bound", [])) else val * 1.1
                        lines.append(f"| Period +{idx+1} | **{val:,.2f}** | {lo:,.2f} | {hi:,.2f} |")
                    lines.append("")
                    lines.append(f"*Model:* {fc.get('model_type', 'Linear Holt-Winters')} | Confidence: {fc.get('confidence', 0.85)*100:.0f}%")
                    
                    ai_insights = self._synthesize_with_llm(question, "\n".join(lines))
                    if ai_insights:
                        lines.append("")
                        lines.append("### 🧠 AI Financial Outlook")
                        lines.append(ai_insights)

                    gen_chart = None
                    if job_id:
                        try:
                            gen_chart = generate_chart_for_prompt(job_id, "revenue growth trend over time")
                        except Exception:
                            pass
                    ret_dict = {
                        "answer": "\n".join(lines),
                        "citations": ["trend_forecast", "analytics_forecast_trend"],
                        "route": "forecast",
                        "tool_used": "analytics_forecast_trend",
                    }
                    if gen_chart:
                        ret_dict["chart"] = gen_chart
                    return ret_dict

        # 2e. Credit Default Risk & Altman Z-Score (with AI Synthesis)
        if any(w in q_clean for w in ("credit risk", "default risk", "altman z", "distress score")):
            from app.models.metric import Metric
            from app.tools.ml.risk import score_risk
            metrics = Metric.query.filter_by(dataset_version=dataset_version_id).all()
            metrics_dict = {m.metric_code: float(m.value) for m in metrics if m.value is not None}
            risk_res = score_risk(metrics_dict)
            lines = [
                "### ⚡ Credit Distress & Default Risk Assessment",
                f"Composite credit risk evaluation: **Score {risk_res.get('score', 0)}/100** ({risk_res.get('risk_band', 'Medium').upper()} RISK)",
                "",
                f"**Assessment:** {risk_res.get('narrative', 'Risk evaluation based on leverage, interest coverage, and working capital cushion.')}",
                "",
                "| Risk Metric Factor | Observed Value | Risk Contribution |",
                "| :--- | :---: | :---: |",
            ]
            for factor in risk_res.get("factors", []):
                lines.append(f"| {factor.get('name', 'Ratio')} | {factor.get('value', 'N/A')} | {factor.get('impact', 'Neutral')} |")
            ai_insights = self._synthesize_with_llm(question, "\n".join(lines))
            if ai_insights:
                lines.append("")
                lines.append("### 🧠 AI Risk Assessment")
                lines.append(ai_insights)
            return {
                "answer": "\n".join(lines),
                "citations": ["credit_risk_model", "analytics_credit_risk"],
                "route": "credit_risk",
                "tool_used": "analytics_credit_risk",
            }

        # 2f. Entity Memory Store & Query
        if q_clean.startswith("remember") or any(w in q_clean for w in ("record note", "save observation", "keep in mind")):
            from app.models.job import Job
            from app.mcp.server import memory_store_observation
            job_obj = db.session.get(Job, job_id) if job_id else None
            company = getattr(job_obj, "company_name", None) or "COMPANY"
            clean_obs = question
            for prefix in ("remember:", "remember that", "remember", "record note:", "record note", "save observation:"):
                if q_clean.startswith(prefix):
                    clean_obs = question[len(prefix):].strip()
                    break
            res = memory_store_observation(tenant_id, company, clean_obs)
            return {
                "answer": f"### 🧠 Observation Saved in Memory\n\nSuccessfully recorded to persistent memory for **{company}**:\n\n> *\"{clean_obs}\"*\n\n*(Memory ID: `{res.get('memory_id')}` — stored across future analyses)*",
                "citations": ["memory_store"],
                "route": "memory",
                "tool_used": "memory_store_observation",
            }

        if any(w in q_clean for w in ("recall", "memory", "stored note", "what do you remember", "past observations")):
            from app.models.job import Job
            from app.mcp.server import memory_query_entity, memory_search_knowledge
            job_obj = db.session.get(Job, job_id) if job_id else None
            company = getattr(job_obj, "company_name", None) or "COMPANY"
            mems = memory_query_entity(tenant_id, company) or memory_search_knowledge(tenant_id, question, limit=5)
            if mems:
                lines = [f"### 🧠 Stored Strategic Observations ({company})", ""]
                for m in mems[:8]:
                    lines.append(f"- **[{m.get('category', 'observation').upper()}]** {m.get('content')} *(Recorded {str(m.get('created_at', ''))[:10]})*")
                return {
                    "answer": "\n".join(lines),
                    "citations": ["memory_query"],
                    "route": "memory",
                    "tool_used": "memory_query_entity",
                }
            else:
                return {
                    "answer": f"No past memory notes found for **{company}**. You can save new observations anytime by asking *\"Remember: [your note]\"*.",
                    "citations": [],
                    "route": "memory",
                    "tool_used": "memory_query_entity",
                }

        # 3. Action Request (Customized Report Generation or Agent Re-run)
        if is_action_request(question):
            return {
                "answer": (
                    "To recompute analysis with new assumptions (e.g. excluding one-off items or adjusting "
                    "projections) or regenerate the report, use the Chat Assistant to re-run the relevant "
                    "agent (e.g. 'redo the risk score excluding one-off item' or 'rerun report_writer')."
                ),
                "citations": [],
                "route": "action_request",
            }

        # 4. Fast Intent Pre-Routing: avoid LLM router if query has clear deterministic target
        matched_tree = resolve_metric_tree(question)
        fact_codes_initial = match_metrics(question)
        route_str: str | None = None

        if is_chart_request(question):
            route_str = "chart_lookup"
        elif fact_codes_initial or matched_tree:
            route_str = "sql"
        elif _CONCERN_WORDS.search(question):
            route_str = "report_lookup"
        elif any(k in q_clean for k in ("overview", "summary", "recommendation", "insight", "executive")):
            route_str = "report_lookup"
        elif any(k in q_clean for k in ("what does", "says in", "disclose", "note to accounts", "according to", "doc", "document", "footnote", "covenant", "auditor", "contingenc", "accounting polic", "extract", "filing")):
            route_str = "document_rag"

        route: RouteDecision | None = None
        if not route_str:
            route_prompt = [{"role": "system", "content": prompts.QA_ROUTER}]
            if history:
                for turn in history[-4:]:
                    role = turn.get("role") or "user"
                    content = turn.get("content") or ""
                    if content:
                        route_prompt.append({"role": role, "content": content})
            route_prompt.append({"role": "user", "content": question})

            try:
                route = self.call_llm(route_prompt, schema=RouteDecision, tier="fast", max_tokens=200)
                route_str = route.route if route else "report_lookup"
            except Exception:
                route_str = "report_lookup"

        route_str = route_str or "report_lookup"

        if route_str == "out_of_scope":
            return {
                "answer": (
                    "That's outside what I can answer from this dataset. I can help with specific metric "
                    "calculations, uploaded statement disclosures, report findings, visual charts, "
                    "or guide you on re-running analysis modules."
                ),
                "citations": [],
                "route": route_str,
            }

        if route_str == "action_request":
            return {
                "answer": (
                    "To recompute analysis with new assumptions (e.g. excluding one-off items or adjusting "
                    "projections) or regenerate the report, use the Chat Assistant to re-run the relevant "
                    "agent (e.g. 'redo the risk score excluding one-off item' or 'rerun report_writer')."
                ),
                "citations": [],
                "route": route_str,
            }

        rows: list[dict] = []
        chunks: list[dict] = []
        charts_data: list[dict] = []
        report_data: list[dict] = []

        # Load available charts if present for this job
        all_charts: list[dict] = (blackboard.read(job_id, "charts") or []) if job_id else []
        generated_chart = None

        if route_str == "chart_lookup" or generated_chart:
            # Match specific chart if named in question, otherwise provide summary of all charts
            q_low = question.lower()
            matching_charts = [
                c for c in all_charts
                if any(w in c.get("title", "").lower() for w in q_low.split() if len(w) > 3)
            ]
            selected = ([generated_chart] if generated_chart else []) + (matching_charts or all_charts)
            if not generated_chart and selected and selected[0].get("png_base64"):
                generated_chart = selected[0]
            charts_data = [
                {
                    "chart_id": c.get("chart_id"),
                    "title": c.get("title"),
                    "caption": c.get("caption", ""),
                    "chart_type": (c.get("spec") or {}).get("chart_type"),
                    "labels": (c.get("spec") or {}).get("labels"),
                    "series": (c.get("spec") or {}).get("series"),
                }
                for c in selected[:6] if c
            ]
            if not charts_data:
                rows = self.call_tool("sql.query_readonly", view="v_metrics", filters={"dataset_version": dataset_version_id}, limit=10)

        elif route_str == "sql":
            matched_code = next(
                (code for code in REGISTRY if code.replace("_", " ") in question.lower() or code in question.lower()),
                None,
            )
            if not matched_code and matched_tree and matched_tree.metric_code in REGISTRY:
                matched_code = matched_tree.metric_code
            filters = {"dataset_version": dataset_version_id}
            if matched_code:
                filters["metric_code"] = matched_code
            rows = self.call_tool("sql.query_readonly", view="v_metrics", filters=filters, limit=20)

        elif route_str == "document_rag":
            docs = Document.query.filter_by(job_id=job_id).all() if job_id else []
            doc_map = {d.id: getattr(d, "original_filename", "Statement") for d in docs}
            document_ids = list(doc_map.keys())
            raw_chunks = self.call_tool(
                "vector.search", tenant_id=tenant_id, query=question, top_k=6, document_ids=document_ids
            )
            chunks = [
                {
                    "document": doc_map.get(c.get("document_id"), "Uploaded Statement"),
                    "page": c.get("page"),
                    "text": c.get("text", ""),
                    "score": c.get("score"),
                }
                for c in raw_chunks
            ]

        elif route_str == "report_lookup":
            findings = Finding.query.filter_by(dataset_version=dataset_version_id).limit(15).all()
            report_data = [{"module": f.module, "title": f.title, "body": f.body, "severity": f.severity} for f in findings]
            if job_id:
                ins_payload = blackboard.read(job_id, "insights") or {}
                for item in ins_payload.get("insights", [])[:5]:
                    report_data.append({"module": "insight", "title": item.get("title"), "body": item.get("body")})
            # Provide high-level chart titles so report overview has complete context
            if all_charts:
                charts_data = [{"chart_id": c.get("chart_id"), "title": c.get("title"), "caption": c.get("caption", "")} for c in all_charts[:4]]

        # Verified figures for whatever the question is about, pre-computed (value, prior
        # period, change, direction) so the composer phrases numbers instead of deriving them.
        fact_codes = match_metrics(question)
        if matched_tree and matched_tree.metric_code not in fact_codes:
            fact_codes.insert(0, matched_tree.metric_code)
        facts = build_facts(dataset_version_id, fact_codes)

        # Questions about risks/concerns need what the analysis actually flagged, whichever
        # route the router picked.
        if not report_data and _CONCERN_WORDS.search(question):
            findings = Finding.query.filter_by(dataset_version=dataset_version_id).all()
            report_data = [{"module": f.module, "title": f.title, "body": f.body, "severity": f.severity}
                           for f in sorted(findings, key=lambda f: _SEVERITY_RANK.get(f.severity, 3))[:8]]

        prompt_content = f"Question: {question}"
        if facts:
            prompt_content += "\n" + embed_json("FACTS_JSON", facts)
        if rows:
            prompt_content += "\n" + embed_json("ROWS_JSON", rows)
        if chunks:
            prompt_content += "\n" + embed_json("CHUNKS_JSON", chunks)
        if charts_data:
            prompt_content += "\n" + embed_json("CHARTS_JSON", charts_data)
        if report_data:
            prompt_content += "\n" + embed_json("REPORT_JSON", report_data)

        # Virtual CFO Diagnostic Compendium drill-down
        if matched_tree:
            q_low = question.lower()
            direction = (
                "decline"
                if any(w in q_low for w in ("drop", "fall", "declin", "down", "deteriorat", "loss", "compress", "low"))
                else ("increase" if any(w in q_low for w in ("rise", "increas", "up", "grow", "expand", "high")) else "change")
            )
            diag_trace = build_cfo_diagnostic_trace(matched_tree.metric_id, direction=direction)
            prompt_content += "\n" + embed_json("DIAGNOSTIC_TREE_JSON", diag_trace)

        compose_prompt = [
            {"role": "system", "content": prompts.QA_COMPOSER},
            {"role": "user", "content": prompt_content},
        ]
        result: QAAnswerResult = self.call_llm(compose_prompt, schema=QAAnswerResult, tier="fast", max_tokens=1000)
        answer, _ = resolve_placeholders(result.answer, dataset_version_id)
        citations = list(result.citations)
        if route_str == "document_rag" and chunks:
            for c in chunks[:3]:
                doc_name = c.get("document") or "Statement"
                page_info = f" (Page {c['page']})" if c.get("page") else ""
                ref = f"{doc_name}{page_info}"
                if ref not in citations:
                    citations.append(ref)

        ret = {
            "answer": answer,
            "citations": citations,
            "route": route_str,
            "tool_used": "search_document_rag" if route_str == "document_rag" else ("web_search_market" if route_str == "web_search" else "data_query_facts"),
        }
        if generated_chart:
            ret["chart"] = {
                "chart_id": generated_chart.get("chart_id"),
                "title": generated_chart.get("title"),
                "caption": generated_chart.get("caption", ""),
                "takeaway": generated_chart.get("takeaway", ""),
                "png_base64": generated_chart.get("png_base64"),
                "section_key": generated_chart.get("section_key"),
            }
        return ret

    def execute(self, spec: TaskSpec) -> AgentResult:
        result = self.answer(spec.tenant_id, spec.params["dataset_version_id"], spec.params["question"])
        return AgentResult(
            task_id=spec.task_id, status=Status.DONE,
            outputs=[ArtifactRef(id="qa_answer", kind="text", uri="inline")],
            summary=result["answer"][:500], confidence=0.7,
        )
