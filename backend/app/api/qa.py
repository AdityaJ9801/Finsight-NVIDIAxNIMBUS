from flask import Blueprint, jsonify, request

from app.agents.delivery.ask_langgraph import get_ask_harness
from app.api.deps import current_tenant_id
from app.models.job import Job

bp = Blueprint("qa", __name__)


@bp.post("")
def ask():
    data = request.get_json(force=True, silent=True) or {}
    job_id = data.get("job_id")
    question = data.get("question")
    if not job_id or not question:
        return jsonify(error="job_id and question are required"), 400

    job = Job.query.filter_by(id=job_id, tenant_id=current_tenant_id()).first()
    if job is None or job.dataset_version_id is None:
        return jsonify(error="not found"), 404

    history = data.get("history")
    preferred_format = data.get("format", "auto")

    harness = get_ask_harness()
    result = harness.run(
        tenant_id=current_tenant_id(),
        dataset_version_id=job.dataset_version_id,
        question=question,
        history=history,
        preferred_format=preferred_format,
        job_id=job.id,
    )
    return jsonify(result)


@bp.get("/capabilities")
def capabilities():
    """Returns all available agents and tools for the intelligent copilot."""
    harness = get_ask_harness()
    return jsonify(
        agents=harness.list_available_agents(),
        tools=harness.list_available_tools(),
    )
