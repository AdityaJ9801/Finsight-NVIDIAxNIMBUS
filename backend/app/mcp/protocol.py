"""Model Context Protocol (MCP) data contracts and types."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class MCPTool(BaseModel):
    name: str
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})
    toolset: str = "general"
    endpoint_id: str = "internal"
    side_effects: str = "none"


class MCPToolCall(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class MCPToolResult(BaseModel):
    success: bool = True
    content: Any = None
    error: str | None = None
    execution_time_ms: float = 0.0
