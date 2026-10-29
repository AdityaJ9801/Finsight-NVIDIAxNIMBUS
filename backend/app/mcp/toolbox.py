"""Dynamic Toolset Box: MCP Client Hub, Tool Registry, and Remote Endpoint Connector."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import requests

from app.extensions import db
from app.mcp.protocol import MCPTool, MCPToolCall, MCPToolResult
from app.mcp.server import mcp_server
from app.models.agent_config import MCPEndpoint

logger = logging.getLogger(__name__)


def _parse_mcp_response(res: requests.Response) -> dict[str, Any]:
    """Parse MCP HTTP response which may be application/json or text/event-stream (SSE)."""
    text = res.text.strip()
    try:
        return res.json()
    except Exception:
        pass

    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            raw_data = line[len("data:"):].strip()
            if raw_data:
                try:
                    return json.loads(raw_data)
                except Exception:
                    continue

    json_start = text.find("{")
    json_end = text.rfind("}")
    if json_start != -1 and json_end != -1 and json_end > json_start:
        try:
            return json.loads(text[json_start : json_end + 1])
        except Exception:
            pass

    raise ValueError(f"Could not parse MCP response: {text[:200]}")


class MCPToolbox:
    """Dynamic Toolset Box managing internal FastMCP tools and remote MCP endpoints."""

    def __init__(self):
        self._internal_tools: dict[str, MCPTool] = {}
        self._internal_funcs: dict[str, Any] = {}
        self._load_internal_tools()

    def _load_internal_tools(self) -> None:
        """Inspect and register all tools declared on the native FastMCP server."""
        try:
            # Inspect tools on the fastmcp instance
            if hasattr(mcp_server, "_tool_manager"):
                # FastMCP internal tools mapping
                tools = mcp_server._tool_manager.list_tools()
                for t in tools:
                    name = getattr(t, "name", str(t))
                    desc = getattr(t, "description", "")
                    fn = getattr(t, "fn", None)
                    schema = getattr(t, "parameters", {}) or {"type": "object", "properties": {}}
                    if hasattr(schema, "model_dump"):
                        schema = schema.model_dump()

                    toolset = (
                        "financial" if "financial" in name else (
                            "analytics" if "analytics" in name else (
                                "memory" if "memory" in name else (
                                    "search" if "search" in name else "general"
                                )
                            )
                        )
                    )
                    spec = MCPTool(
                        name=name,
                        description=desc,
                        parameters=schema if isinstance(schema, dict) else {},
                        toolset=toolset,
                        endpoint_id="internal",
                    )
                    self._internal_tools[name] = spec
                    if fn:
                        self._internal_funcs[name] = fn
            else:
                # Fallback registration by inspecting mcp_server functions
                self._fallback_register_internal()
        except Exception as exc:
            logger.warning("FastMCP reflection notice: %s. Using direct registration fallback.", exc)
            self._fallback_register_internal()

    def _fallback_register_internal(self) -> None:
        from app.mcp import server as srv
        native = [
            ("financial_compute_ratios", "Calculate core financial ratios", srv.financial_compute_ratios, "financial"),
            ("financial_health_score", "Compute rules-based financial health score", srv.financial_health_score, "financial"),
            ("financial_detailed_analysis", "Run DuPont and working capital bridge", srv.financial_detailed_analysis, "financial"),
            ("analytics_detect_anomalies", "Detect statistical anomalies", srv.analytics_detect_anomalies, "analytics"),
            ("analytics_forecast_trend", "Generate forecast using trend modeling", srv.analytics_forecast_trend, "analytics"),
            ("analytics_credit_risk", "Evaluate default risk via Altman Z-score", srv.analytics_credit_risk, "analytics"),
            ("data_query_facts", "Query structured financial facts safely", srv.data_query_facts, "data"),
            ("search_document_rag", "Search document chunks using in-process RAG", srv.search_document_rag, "search"),
            ("web_search_market", "Search public financial news and market context", srv.web_search_market, "search"),
            ("visualization_chart_spec", "Dynamically construct domain charts", srv.visualization_chart_spec, "visualization"),
            ("memory_store_observation", "Store observation or note in lightweight SQLite memory", srv.memory_store_observation, "memory"),
            ("memory_query_entity", "Retrieve historical observations and notes for an entity", srv.memory_query_entity, "memory"),
            ("memory_search_knowledge", "Search knowledge base memory by keyword", srv.memory_search_knowledge, "memory"),
            ("memory_delete_observation", "Delete an outdated memory observation by ID", srv.memory_delete_observation, "memory"),
            ("tavily_validate_value", "Validate financial metric or ratio against public Internet data, filings, and market consensus via Tavily", srv.tavily_validate_value, "validation"),
        ]
        for name, desc, fn, toolset in native:
            self._internal_tools[name] = MCPTool(
                name=name,
                description=desc,
                parameters={"type": "object", "properties": {}},
                toolset=toolset,
                endpoint_id="internal",
            )
            self._internal_funcs[name] = fn

    def list_tools(self, toolset: str | None = None, endpoint_id: str | None = None) -> list[dict[str, Any]]:
        """List all tools currently available across internal FastMCP and remote MCP endpoints."""
        all_tools: list[dict[str, Any]] = [t.model_dump() for t in self._internal_tools.values()]

        # Query all active external MCP endpoints from SQLite
        try:
            endpoints = MCPEndpoint.query.filter_by(status="active").all()
            for ep in endpoints:
                for ct in (ep.cached_tools or []):
                    tool_item = {
                        "name": ct.get("name"),
                        "description": ct.get("description", ""),
                        "parameters": ct.get("parameters") or ct.get("inputSchema", {}),
                        "toolset": ct.get("toolset", ep.name),
                        "endpoint_id": ep.id,
                        "endpoint_name": ep.name,
                    }
                    all_tools.append(tool_item)
        except Exception:
            pass

        if toolset:
            all_tools = [t for t in all_tools if t.get("toolset") == toolset]
        if endpoint_id:
            all_tools = [t for t in all_tools if t.get("endpoint_id") == endpoint_id]
        return all_tools

    def sync_endpoint(self, endpoint_id: str) -> dict[str, Any]:
        """Connect to a remote MCP endpoint, perform tools/list handshake, and sync tools."""
        ep = MCPEndpoint.query.get(endpoint_id)
        if not ep:
            raise ValueError(f"MCP endpoint '{endpoint_id}' not found")

        headers = {"Content-Type": "application/json"}
        if ep.auth_token:
            headers["Authorization"] = f"Bearer {ep.auth_token}"

        target_url = ep.endpoint_url.strip()
        tools_found = []

        try:
            # Standard MCP JSON-RPC tools/list request
            payload = {
                "jsonrpc": "2.0",
                "id": f"sync_{int(time.time())}",
                "method": "tools/list",
                "params": {},
            }
            res = requests.post(target_url, json=payload, headers=headers, timeout=15)
            if res.ok:
                data = _parse_mcp_response(res)
                result = data.get("result", {})
                raw_tools = result.get("tools", [])
                for rt in raw_tools:
                    tools_found.append({
                        "name": rt.get("name"),
                        "description": rt.get("description", ""),
                        "parameters": rt.get("inputSchema", rt.get("parameters", {})),
                        "toolset": ep.name,
                    })
                ep.status = "active"
                ep.status_message = f"Successfully synced {len(tools_found)} tools"
            else:
                ep.status = "error"
                ep.status_message = f"HTTP {res.status_code}: {res.text[:120]}"
        except Exception as exc:
            logger.warning("Remote MCP sync failed for %s: %s", target_url, exc)
            ep.status = "offline"
            ep.status_message = str(exc)

        ep.cached_tools = tools_found
        ep.tool_count = len(tools_found)
        ep.last_synced_at = datetime.now(timezone.utc)
        db.session.commit()

        return {
            "endpoint_id": ep.id,
            "status": ep.status,
            "tool_count": ep.tool_count,
            "tools": tools_found,
            "message": ep.status_message,
        }

    def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> MCPToolResult:
        """Invoke an MCP tool, routing to either the native FastMCP server or remote MCP endpoint."""
        started = time.monotonic()

        # 1. Check internal native FastMCP tools
        if tool_name in self._internal_funcs:
            fn = self._internal_funcs[tool_name]
            try:
                result = fn(**arguments)
                elapsed_ms = (time.monotonic() - started) * 1000.0
                return MCPToolResult(success=True, content=result, execution_time_ms=elapsed_ms)
            except Exception as err:
                elapsed_ms = (time.monotonic() - started) * 1000.0
                logger.exception("Internal MCP tool error on %s: %s", tool_name, err)
                return MCPToolResult(success=False, error=str(err), execution_time_ms=elapsed_ms)

        # 2. Check remote MCP endpoints
        try:
            endpoints = MCPEndpoint.query.filter_by(status="active").all()
            for ep in endpoints:
                for ct in (ep.cached_tools or []):
                    if ct.get("name") == tool_name:
                        return self._call_remote_tool(ep, tool_name, arguments, started)
        except Exception as err:
            logger.warning("Remote MCP search error: %s", err)

        return MCPToolResult(
            success=False,
            error=f"Tool '{tool_name}' not found in any registered toolset.",
            execution_time_ms=(time.monotonic() - started) * 1000.0,
        )

    def _call_remote_tool(
        self,
        ep: MCPEndpoint,
        tool_name: str,
        arguments: dict[str, Any],
        started: float,
    ) -> MCPToolResult:
        """Execute tool call over MCP protocol to external server."""
        headers = {"Content-Type": "application/json"}
        if ep.auth_token:
            headers["Authorization"] = f"Bearer {ep.auth_token}"

        payload = {
            "jsonrpc": "2.0",
            "id": f"call_{int(time.time())}",
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }

        try:
            res = requests.post(ep.endpoint_url, json=payload, headers=headers, timeout=30)
            elapsed_ms = (time.monotonic() - started) * 1000.0
            if not res.ok:
                return MCPToolResult(
                    success=False,
                    error=f"Remote MCP error HTTP {res.status_code}: {res.text[:200]}",
                    execution_time_ms=elapsed_ms,
                )
            data = _parse_mcp_response(res)
            if "error" in data:
                return MCPToolResult(
                    success=False,
                    error=str(data["error"]),
                    execution_time_ms=elapsed_ms,
                )
            result = data.get("result", {})
            return MCPToolResult(
                success=True,
                content=result.get("content", result),
                execution_time_ms=elapsed_ms,
            )
        except Exception as exc:
            elapsed_ms = (time.monotonic() - started) * 1000.0
            return MCPToolResult(
                success=False,
                error=f"Failed to communicate with remote MCP endpoint: {exc}",
                execution_time_ms=elapsed_ms,
            )


    def ensure_tavily_endpoint(self) -> MCPEndpoint | None:
        """Ensure Tavily MCP endpoint is registered in the database and synced."""
        import os
        from flask import current_app
        api_key = ""
        try:
            api_key = current_app.config.get("TAVILY_API_KEY", "")
        except Exception:
            pass
        if not api_key:
            api_key = os.environ.get("TAVILY_API_KEY", "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")

        target_url = f"https://mcp.tavily.com/mcp/?tavilyApiKey={api_key}"
        try:
            ep = MCPEndpoint.query.filter(
                (MCPEndpoint.name.ilike("%tavily%")) | (MCPEndpoint.endpoint_url.ilike("%mcp.tavily.com%"))
            ).first()
            if not ep:
                from app.utils.ids import new_id
                ep = MCPEndpoint(
                    id=new_id("mcp_tavily_"),
                    name="Tavily Web Search & Validation (MCP)",
                    endpoint_url=target_url,
                    transport="sse",
                    auth_token=api_key,
                    status="active",
                    status_message="Tavily live web intelligence & fact checking MCP server",
                )
                db.session.add(ep)
                db.session.commit()
                try:
                    self.sync_endpoint(ep.id)
                except Exception as sync_err:
                    logger.warning("Initial Tavily MCP sync notice: %s", sync_err)
            elif ep.endpoint_url != target_url:
                ep.endpoint_url = target_url
                ep.auth_token = api_key
                db.session.commit()
                try:
                    self.sync_endpoint(ep.id)
                except Exception:
                    pass
            return ep
        except Exception as e:
            logger.warning("ensure_tavily_endpoint notice: %s", e)
            return None


# Global singleton instance of the dynamic MCP Toolbox
mcp_toolbox = MCPToolbox()
