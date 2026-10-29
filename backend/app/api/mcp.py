"""API endpoints for the dynamic MCP Toolset Box and endpoint registry."""
from __future__ import annotations

from datetime import datetime, timezone
from flask import Blueprint, jsonify, request

from app.extensions import db
from app.mcp.toolbox import mcp_toolbox
from app.models.agent_config import MCPEndpoint
from app.utils.ids import new_id

bp = Blueprint("mcp", __name__)


@bp.get("/tools")
def list_tools():
    """List all available tools in the toolset box (internal FastMCP + external MCP endpoints)."""
    toolset = request.args.get("toolset")
    endpoint_id = request.args.get("endpoint_id")
    tools = mcp_toolbox.list_tools(toolset=toolset, endpoint_id=endpoint_id)
    return jsonify({
        "tools": tools,
        "count": len(tools),
        "toolsets": sorted(list({t.get("toolset", "general") for t in tools})),
    })


@bp.get("/endpoints")
def list_endpoints():
    """List all registered MCP endpoints."""
    # Ensure Tavily MCP is seeded and ready
    try:
        mcp_toolbox.ensure_tavily_endpoint()
    except Exception:
        pass

    # Always include internal FastMCP endpoint
    internal_endpoint = {
        "id": "internal",
        "name": "FinSight Internal FastMCP Server",
        "endpoint_url": "internal://fastmcp",
        "transport": "internal",
        "status": "active",
        "status_message": "Core deterministic and statistical financial tools",
        "tool_count": len([t for t in mcp_toolbox.list_tools() if t.get("endpoint_id") == "internal"]),
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "created_at": None,
    }

    external_endpoints = []
    try:
        eps = MCPEndpoint.query.order_by(MCPEndpoint.created_at.desc()).all()
        external_endpoints = [e.to_dict() for e in eps]
    except Exception:
        pass

    return jsonify({"endpoints": [internal_endpoint] + external_endpoints})


@bp.post("/tavily-key")
def update_tavily_key():
    """Update Tavily API key dynamically from settings and re-sync endpoint."""
    import os
    from flask import current_app
    data = request.get_json() or {}
    key = (data.get("tavily_api_key") or data.get("api_key") or "").strip()
    if not key:
        return jsonify({"error": "Tavily API key is required"}), 400

    current_app.config["TAVILY_API_KEY"] = key
    current_app.config["TAVILY_MCP_URL"] = f"https://mcp.tavily.com/mcp/?tavilyApiKey={key}"
    os.environ["TAVILY_API_KEY"] = key
    os.environ["TAVILY_MCP_URL"] = f"https://mcp.tavily.com/mcp/?tavilyApiKey={key}"

    # Re-sync Tavily endpoint
    ep = mcp_toolbox.ensure_tavily_endpoint()
    sync_res = {}
    if ep:
        sync_res = mcp_toolbox.sync_endpoint(ep.id)

    return jsonify({
        "success": True,
        "message": "Tavily API Key updated and MCP endpoint synchronized.",
        "endpoint": ep.to_dict() if ep else None,
        "sync": sync_res,
    })


@bp.post("/endpoints")
def add_endpoint():
    """Register a new remote MCP endpoint and immediately sync its tools."""
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    endpoint_url = (data.get("endpoint_url") or "").strip()

    if not name or not endpoint_url:
        return jsonify({"error": "name and endpoint_url are required."}), 400

    ep = MCPEndpoint(
        id=new_id("mcp_"),
        name=name,
        endpoint_url=endpoint_url,
        transport=data.get("transport", "sse"),
        auth_token=data.get("auth_token") or None,
        status="active",
    )
    db.session.add(ep)
    db.session.commit()

    # Automatically run initial tool synchronization
    sync_result = mcp_toolbox.sync_endpoint(ep.id)

    return jsonify({
        "endpoint": ep.to_dict(),
        "sync": sync_result,
    }), 201


@bp.put("/endpoints/<endpoint_id>")
def update_endpoint(endpoint_id: str):
    ep = MCPEndpoint.query.get(endpoint_id)
    if not ep:
        return jsonify({"error": f"Endpoint '{endpoint_id}' not found."}), 404

    data = request.get_json() or {}
    if "name" in data:
        ep.name = data["name"].strip()
    if "endpoint_url" in data:
        ep.endpoint_url = data["endpoint_url"].strip()
    if "transport" in data:
        ep.transport = data["transport"]
    if "auth_token" in data and data["auth_token"] != "***":
        ep.auth_token = data["auth_token"] or None
    if "status" in data:
        ep.status = data["status"]

    ep.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify(ep.to_dict())


@bp.delete("/endpoints/<endpoint_id>")
def delete_endpoint(endpoint_id: str):
    if endpoint_id == "internal":
        return jsonify({"error": "Cannot delete internal FastMCP server."}), 403

    ep = MCPEndpoint.query.get(endpoint_id)
    if not ep:
        return jsonify({"error": f"Endpoint '{endpoint_id}' not found."}), 404

    db.session.delete(ep)
    db.session.commit()
    return jsonify({"success": True, "message": f"Endpoint '{endpoint_id}' deleted."})


@bp.post("/endpoints/<endpoint_id>/sync")
def sync_endpoint_tools(endpoint_id: str):
    """Trigger manual sync and tool discovery for an MCP endpoint."""
    if endpoint_id == "internal":
        mcp_toolbox._load_internal_tools()
        return jsonify({"success": True, "message": "Internal tools refreshed."})

    try:
        result = mcp_toolbox.sync_endpoint(endpoint_id)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@bp.post("/tools/call")
def call_tool():
    """Test execute an MCP tool directly through the toolbox."""
    data = request.get_json() or {}
    tool_name = (data.get("name") or data.get("tool_name") or "").strip()
    arguments = data.get("arguments") or {}

    if not tool_name:
        return jsonify({"error": "name or tool_name is required."}), 400

    result = mcp_toolbox.call_tool(tool_name, arguments)
    return jsonify({
        "success": result.success,
        "content": result.content,
        "error": result.error,
        "execution_time_ms": round(result.execution_time_ms, 2),
    })
