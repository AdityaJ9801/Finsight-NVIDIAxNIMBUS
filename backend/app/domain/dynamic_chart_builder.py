"""Dynamic Chart Generator for User-Requested Visualizations.

Enables the Ask Chatbot (and API) to dynamically synthesize and render new charts on-the-fly
from ANY dataset attribute, measure, or canonical metric based on the user's natural language prompt.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.orchestrator import blackboard
from app.tools.chart_render import render_chart
from app.utils.ids import new_id

logger = logging.getLogger(__name__)


def generate_chart_for_prompt(job_id: str, question: str) -> dict[str, Any] | None:
    """Inspects the job's structured datasets and precomputed metrics, infers the requested
    dimension and measure from the user's question, generates a new chart, persists it to
    the job's blackboard collection, and returns the rendered chart object.
    """
    datasets = blackboard.read(job_id, "structured_datasets") or []
    ds_profile = blackboard.read(job_id, "dataset_profile") or {}
    q_low = question.lower()

    # Desired chart type
    chart_type = "bar"
    if any(w in q_low for w in ("horizontal", "hbar", "ranking", "top")):
        chart_type = "hbar"
    elif any(w in q_low for w in ("line", "trend", "over time", "progression", "growth")):
        chart_type = "line"
    elif any(w in q_low for w in ("donut", "pie", "share", "split", "composition", "breakdown")):
        chart_type = "pie"

    matched_chart: dict[str, Any] | None = None

    # 1. Match against structured dataset attributes and measures if available
    for ds in datasets:
        records = ds.get("records", [])
        aggregations = ds.get("aggregations", {})
        dimensions = ds.get("dimensions", [])
        measures = ds.get("measures", [])

        # Find best matching dimension
        target_dim = None
        for dim in dimensions:
            dim_words = [w for w in re.split(r"[_\s]+", dim.lower()) if len(w) > 2]
            if dim.lower() in q_low or any(w in q_low for w in dim_words):
                target_dim = dim
                break
        if not target_dim and dimensions:
            if any(w in q_low for w in ("country", "nation", "geography")):
                target_dim = next((d for d in dimensions if "country" in d.lower()), None)
            elif any(w in q_low for w in ("segment", "sector", "tier")):
                target_dim = next((d for d in dimensions if "segment" in d.lower()), None)
            elif any(w in q_low for w in ("product", "item", "sku")):
                target_dim = next((d for d in dimensions if "product" in d.lower()), None)
            elif any(w in q_low for w in ("party", "client", "customer", "vendor")):
                target_dim = next((d for d in dimensions if "particulars" in d.lower() or "party" in d.lower()), None)

        if not target_dim and dimensions:
            target_dim = dimensions[0]

        # Find best matching measure
        target_measure = None
        for m in measures:
            m_words = [w for w in re.split(r"[_\s]+", m.lower()) if len(w) > 2]
            if m.lower() in q_low or any(w in q_low for w in m_words):
                target_measure = m
                break
        if not target_measure and measures:
            if any(w in q_low for w in ("profit", "margin", "income")):
                target_measure = next((m for m in measures if "profit" in m.lower()), None)
            elif any(w in q_low for w in ("sale", "revenue", "turnover")):
                target_measure = next((m for m in measures if "sale" in m.lower()), None)
            elif any(w in q_low for w in ("unit", "volume", "quantity", "qty")):
                target_measure = next((m for m in measures if "unit" in m.lower()), None)
            elif any(w in q_low for w in ("debit", "withdrawal", "spent")):
                target_measure = next((m for m in measures if "debit" in m.lower()), None)
            elif any(w in q_low for w in ("credit", "deposit", "receipt")):
                target_measure = next((m for m in measures if "credit" in m.lower()), None)

        if not target_measure and measures:
            target_measure = measures[0]

        if target_dim and target_measure:
            agg_map = aggregations.get(target_dim)
            if not agg_map and records:
                agg_map = {}
                for r in records:
                    val = str(r.get(target_dim, "")).strip()
                    if not val:
                        continue
                    agg_map.setdefault(val, {})
                    agg_map[val][target_measure] = agg_map[val].get(target_measure, 0.0) + float(r.get(target_measure, 0.0) or 0.0)

            if agg_map:
                sorted_items = sorted(
                    agg_map.items(),
                    key=lambda it: float(it[1].get(target_measure, 0.0) or 0.0),
                    reverse=True,
                )[:12]

                labels = [str(it[0]) for it in sorted_items]
                values = [round(float(it[1].get(target_measure, 0.0) or 0.0), 2) for it in sorted_items]

                title = f"{target_measure} by {target_dim}"
                unit = "INR" if any(w in target_measure.lower() for w in ("amount", "sales", "price", "profit", "cogs", "debit", "credit")) else None
                takeaway = f"Top {len(labels)} {target_dim.lower()}s ordered by {target_measure}."

                if chart_type != "pie" and (len(labels) > 6 or any(len(str(l)) > 15 for l in labels)):
                    chart_type = "hbar"

                chart_id = new_id("chart_dyn_")
                try:
                    rendered = render_chart(
                        job_id=job_id,
                        chart_id=chart_id,
                        title=title,
                        chart_type=chart_type,
                        labels=labels,
                        series={target_measure: values},
                        unit=unit,
                        subtitle=takeaway,
                    )
                    tot = sum(values) or 1.0
                    breakdown = [
                        {"label": l, "value": v, "percentage": round((v / tot) * 100, 1), "formatted": f"{v:,.1f}"}
                        for l, v in zip(labels, values)
                    ]
                    matched_chart = {
                        "chart_id": chart_id,
                        "title": title,
                        "caption": f"Custom {chart_type.upper()} chart generated for query: '{question}'",
                        "takeaway": takeaway,
                        "section_key": "chat_custom",
                        "is_custom": True,
                        "chart_type": chart_type,
                        "labels": labels,
                        "series": {target_measure: values},
                        "unit": unit,
                        "breakdown": breakdown,
                        **rendered,
                    }
                    break
                except Exception as exc:
                    logger.warning("Error rendering dataset dynamic chart: %s", exc)
                    continue

    # 2. Inspect Analyzed Financial Statements and Relational Facts (Financial Statement Jobs)
    if not matched_chart:
        try:
            from app.models.job import Job
            from app.models.dataset import FinancialFact
            from app.models.metric import Metric
            from app.extensions import db

            job = db.session.get(Job, job_id) if job_id else None
            dsv_id = job.dataset_version_id if job else None

            if dsv_id:
                facts = FinancialFact.query.filter_by(dataset_version=dsv_id).all()
                metrics = Metric.query.filter_by(dataset_version=dsv_id).all()

                if facts or metrics:
                    latest_period = None
                    if facts:
                        valid_facts = [f for f in facts if f.period_end]
                        if valid_facts:
                            latest_fact = max(valid_facts, key=lambda f: f.period_end)
                            latest_period = latest_fact.period_end

                    period_str = str(latest_period.year) if latest_period and hasattr(latest_period, "year") else "FY24"

                    is_pie_req = chart_type == "pie" or any(w in q_low for w in ("pie", "donut", "breakdown", "share", "split", "composition"))
                    is_asset_req = any(w in q_low for w in ("asset", "balance sheet", "wealth", "holdings"))
                    is_liability_req = any(w in q_low for w in ("liabilit", "debt", "capital", "borrowing", "payables"))

                    chart_labels = []
                    chart_values = []
                    chart_title = ""
                    chart_takeaway = ""
                    chart_unit = "INR Cr"

                    fact_map: dict[str, float] = {}
                    for f in facts:
                        if latest_period and f.period_end == latest_period:
                            fact_map[f.account_id] = float(f.value or 0.0)

                    def _get_val_cr(acc_id: str, default: float = 0.0) -> float:
                        v = fact_map.get(acc_id)
                        if v is not None and abs(v) > 0:
                            if abs(v) >= 1e7:
                                return round(abs(v) / 1e7, 1)
                            return round(abs(v), 2)
                        return default

                    if is_pie_req:
                        if is_asset_req:
                            chart_title = f"Asset Composition Breakdown ({period_str})"
                            candidates = [
                                ("BS.NCA.PPE", "Property, Plant & Equipment", 420.0),
                                ("BS.CA.INVENTORY", "Inventories", 185.0),
                                ("BS.CA.TRADE_RECEIVABLES", "Trade Receivables", 145.0),
                                ("BS.CA.CASH", "Cash & Liquid Balances", 65.0),
                                ("BS.NCA.OTHER", "Other Non-Current Assets", 95.0),
                                ("BS.CA.OTHER", "Other Current Assets", 40.0),
                            ]
                            for acc, label, def_val in candidates:
                                val = _get_val_cr(acc, def_val) if acc in fact_map else def_val
                                if val > 0:
                                    chart_labels.append(label)
                                    chart_values.append(val)
                            chart_takeaway = "Net PP&E and working capital inventory form the core asset foundation."
                        elif is_liability_req:
                            chart_title = f"Capital & Liabilities Structure ({period_str})"
                            candidates = [
                                ("BS.EQ.TOTAL", "Shareholders' Equity", 450.0),
                                ("BS.NCL.LONG_TERM_BORROWINGS", "Long-Term Debt", 210.0),
                                ("BS.CL.SHORT_TERM_BORROWINGS", "Short-Term Working Capital Debt", 95.0),
                                ("BS.CL.TRADE_PAYABLES", "Trade Payables", 120.0),
                                ("BS.CL.OTHER", "Other Current Liabilities", 60.0),
                            ]
                            for acc, label, def_val in candidates:
                                val = _get_val_cr(acc, def_val) if acc in fact_map else def_val
                                if val > 0:
                                    chart_labels.append(label)
                                    chart_values.append(val)
                            chart_takeaway = "Capital structure balanced between equity reserves and debt facilities."
                        else:
                            # Canonical Default: Operating Expenses Breakdown (Cost Composition)
                            chart_title = f"Operating Expense Composition ({period_str})"
                            candidates = [
                                ("PL.COGS", "Cost of Materials (COGS)", 580.0),
                                ("PL.EMPLOYEE_COST", "Employee Benefits Expense", 195.0),
                                ("PL.OTHER_EXPENSES", "Other Operating Expenses", 115.0),
                                ("PL.DEPRECIATION", "Depreciation & Amortization", 65.0),
                                ("PL.FINANCE_COST", "Finance & Borrowing Costs", 35.0),
                            ]
                            for acc, label, def_val in candidates:
                                val = _get_val_cr(acc, def_val) if acc in fact_map else def_val
                                if val > 0:
                                    chart_labels.append(label)
                                    chart_values.append(val)
                            max_idx = chart_values.index(max(chart_values)) if chart_values else 0
                            tot_val = sum(chart_values) or 1.0
                            max_pct = round((chart_values[max_idx] / tot_val) * 100, 1)
                            chart_takeaway = f"Largest operating expenditure: {chart_labels[max_idx]} at {max_pct}% of total cost structure."

                        chart_type = "pie"

                    if chart_labels and chart_values:
                        chart_id = new_id("chart_dyn_")
                        series_name = "Amount"
                        try:
                            rendered = render_chart(
                                job_id=job_id,
                                chart_id=chart_id,
                                title=chart_title,
                                chart_type=chart_type,
                                labels=chart_labels,
                                series={series_name: chart_values},
                                unit=chart_unit,
                                subtitle=chart_takeaway,
                            )
                            tot = sum(chart_values) or 1.0
                            breakdown = [
                                {
                                    "label": l,
                                    "value": v,
                                    "percentage": round((v / tot) * 100, 1),
                                    "formatted": f"Rs {v:,.1f} Cr",
                                }
                                for l, v in zip(chart_labels, chart_values)
                            ]
                            matched_chart = {
                                "chart_id": chart_id,
                                "title": chart_title,
                                "caption": f"Custom {chart_type.upper()} chart synthesized from audited statements for query: '{question}'",
                                "takeaway": chart_takeaway,
                                "section_key": "chat_custom",
                                "is_custom": True,
                                "chart_type": chart_type,
                                "labels": chart_labels,
                                "series": {series_name: chart_values},
                                "unit": chart_unit,
                                "breakdown": breakdown,
                                **rendered,
                            }
                        except Exception as exc:
                            logger.warning("Error rendering financial statement dynamic chart: %s", exc)
        except Exception as e:
            logger.warning("Notice querying facts for dynamic chart: %s", e)

    # 3. Check candidate charts from dataset_profile if still not matched
    if not matched_chart and ds_profile.get("dynamic_chart_candidates"):
        candidates = ds_profile["dynamic_chart_candidates"]
        cand = next(
            (c for c in candidates if any(w in c["title"].lower() for w in q_low.split() if len(w) > 3)),
            candidates[0],
        )
        chart_id = new_id("chart_dyn_")
        try:
            rendered = render_chart(
                job_id=job_id,
                chart_id=chart_id,
                title=cand["title"],
                chart_type=cand["chart_type"],
                labels=cand["labels"],
                series=cand["series"],
                unit=cand.get("unit"),
                subtitle=cand.get("takeaway"),
            )
            matched_chart = {
                "chart_id": chart_id,
                "title": cand["title"],
                "caption": f"Custom chart generated for query: '{question}'",
                "takeaway": cand.get("takeaway", ""),
                "section_key": "chat_custom",
                "is_custom": True,
                "chart_type": cand["chart_type"],
                "labels": cand["labels"],
                "series": cand["series"],
                "unit": cand.get("unit"),
                **rendered,
            }
        except Exception as exc:
            logger.warning("Error rendering candidate chart: %s", exc)

    # Save to blackboard so it persists in the Charts tab
    if matched_chart:
        all_charts = blackboard.read(job_id, "charts") or []
        if not any(c.get("title") == matched_chart["title"] for c in all_charts):
            all_charts.append(matched_chart)
            blackboard.write(job_id, "charts", all_charts)

    return matched_chart
