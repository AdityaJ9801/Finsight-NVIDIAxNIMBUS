from flask import Flask
from flask_cors import CORS
from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.config import Config
from app.extensions import db


@event.listens_for(Engine, "connect")
def _sqlite_pragmas(dbapi_connection, connection_record):
    """WAL mode + a busy timeout so concurrent stage-supervisor threads writing to SQLite
    (see agents/data/supervisor.py's ThreadPoolExecutor fan-out) retry instead of
    immediately raising 'database is locked'. No-ops on non-SQLite connections."""
    if type(dbapi_connection).__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA cache_size=-32000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA mmap_size=268435456")
        cursor.close()



def _register_error_handlers(app: Flask) -> None:
    """Every API failure is JSON with an `error` the UI can show as-is. Without this, an
    outage at the model provider surfaced as Werkzeug's HTML debugger page (or a bare 500),
    which the client could only report as "Request failed"."""
    from urllib.parse import urlparse

    import requests
    from flask import jsonify, request
    from werkzeug.exceptions import HTTPException

    @app.errorhandler(requests.RequestException)
    def llm_unavailable(exc: requests.RequestException):
        response = getattr(exc, "response", None)
        host = urlparse(getattr(response, "url", None) or getattr(exc.request, "url", "") or "").netloc or "the model provider"
        if response is not None:
            what = f"returned {response.status_code} {response.reason or ''}".strip()
        elif isinstance(exc, requests.Timeout):
            what = "timed out"
        else:
            what = "couldn't be reached"
        app.logger.warning("LLM call failed: %s", exc)
        return jsonify(error=f"The language model at {host} {what}. Nothing was changed. Try again shortly, "
                             f"or switch provider under Model & keys."), 502

    @app.errorhandler(Exception)
    def unexpected(exc: Exception):
        if isinstance(exc, HTTPException):
            if request.path.startswith("/api/"):
                return jsonify(error=exc.description or exc.name), exc.code
            return exc
        app.logger.exception("Unhandled error on %s", request.path)
        return jsonify(error="Something went wrong on the server and the request wasn't completed. "
                             "The details are in the API log."), 500


def create_app(config_class: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    CORS(app)

    from app import models  # noqa: F401  (registers models with SQLAlchemy metadata)

    from app.api.jobs import bp as jobs_bp
    from app.api.qa import bp as qa_bp
    from app.api.reports import bp as reports_bp
    from app.api.results import bp as results_bp
    from app.api.review import bp as review_bp
    from app.api.search import bp as search_bp
    from app.api.llm_config import bp as llm_bp
    from app.api.benchmarks import bp as benchmarks_bp

    app.register_blueprint(jobs_bp, url_prefix="/api/jobs")
    app.register_blueprint(review_bp, url_prefix="/api/review")
    app.register_blueprint(results_bp, url_prefix="/api/jobs")
    app.register_blueprint(reports_bp, url_prefix="/api/jobs")
    app.register_blueprint(qa_bp, url_prefix="/api/qa")
    app.register_blueprint(search_bp, url_prefix="/api/search")
    app.register_blueprint(llm_bp, url_prefix="/api/llm")
    app.register_blueprint(benchmarks_bp, url_prefix="/api/benchmarks")
    from app.api.agents import bp as agents_bp
    from app.api.mcp import bp as mcp_bp

    app.register_blueprint(agents_bp, url_prefix="/api/agents")
    app.register_blueprint(mcp_bp, url_prefix="/api/mcp")

    if not app.config.get("TESTING"):
        with app.app_context():
            try:
                from app.cli import ensure_database_ready
                ensure_database_ready()

                from app.models.job import JobProfile
                from app.models.agent_config import AgentDefinition, MCPEndpoint, A2AMessageLog, AgentMemory

                JobProfile.__table__.create(bind=db.engine, checkfirst=True)
                AgentDefinition.__table__.create(bind=db.engine, checkfirst=True)
                MCPEndpoint.__table__.create(bind=db.engine, checkfirst=True)
                A2AMessageLog.__table__.create(bind=db.engine, checkfirst=True)
                AgentMemory.__table__.create(bind=db.engine, checkfirst=True)


                # Seed sample custom agents if none exist
                if AgentDefinition.query.count() == 0:
                    default_agents = [
                        AgentDefinition(
                            id="risk_auditor",
                            name="Risk & Distress Auditor",
                            role="Default Risk & Solvency Specialist",
                            description="Calculates Altman Z-score, Piotroski F-score, and identifies distress flags.",
                            system_prompt=(
                                "You are the Risk & Distress Auditor. Analyze corporate balance sheets, debt burdens, "
                                "and liquidity constraints. Calculate Altman Z-score and flag early signs of financial distress."
                            ),
                            skills=["credit_risk_scoring", "covenant_monitoring", "ratio_calculation"],
                            assigned_tools=["analytics_credit_risk", "financial_compute_ratios"],
                            model_tier="reasoning",
                            is_builtin=False,
                            allowed_peers=["*"],
                        ),
                        AgentDefinition(
                            id="forensic_examiner",
                            name="Forensic Data Examiner",
                            role="Anomaly & Footnote Investigator",
                            description="Investigates statistical anomalies, unusual variance jumps, and hidden liabilities.",
                            system_prompt=(
                                "You are the Forensic Data Examiner. Scrutinize financial statements for irregular revenue timing, "
                                "unusual variance spikes, working capital anomalies, and unmapped footnote items."
                            ),
                            skills=["anomaly_detection", "working_capital_bridge", "audit_verification"],
                            assigned_tools=["analytics_detect_anomalies", "financial_detailed_analysis", "search_document_rag"],
                            model_tier="default",
                            is_builtin=False,
                            allowed_peers=["*"],
                        ),
                        AgentDefinition(
                            id="memory_synthesizer",
                            name="Institutional Memory & Knowledge Agent",
                            role="Historical Memory & Guidance Tracker",
                            description="Maintains longitudinal memory of corporate guidance, management tone, and past observations.",
                            system_prompt=(
                                "You are the Institutional Memory Agent. Recall historical observations, past quarterly guidance, "
                                "and risk flags for companies using SQLite memory tools. Store key takeaways to track trajectory over time."
                            ),
                            skills=["memory_retrieval", "longitudinal_tracking", "guidance_reconciliation"],
                            assigned_tools=["memory_query_entity", "memory_search_knowledge", "memory_store_observation"],
                            model_tier="default",
                            is_builtin=False,
                            allowed_peers=["*"],
                        ),
                    ]
                    db.session.add_all(default_agents)
                    db.session.commit()
            except Exception as exc:
                app.logger.debug("Table check skipped: %s", exc)

    @app.get("/")
    def index():
        return {
            "name": "FinSight Multi-Agent Financial Analysis Platform API",
            "status": "online",
            "version": "1.0.0",
            "health": "/api/health",
            "endpoints": {
                "health": "/api/health",
                "jobs": "/api/jobs",
                "qa": "/api/qa",
                "benchmarks": "/api/benchmarks",
                "llm_status": "/api/llm/status",
            },
            "message": "API is active. Open the web frontend or query /api endpoints.",
        }

    @app.get("/healthz")
    @app.get("/health")
    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    _register_error_handlers(app)

    from app.cli import register_cli

    register_cli(app)

    return app
