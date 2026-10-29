from datetime import datetime, timezone
from typing import Any

from app.extensions import db
from app.utils.ids import new_id


class AgentDefinition(db.Model):
    """Configuration for system and user-created custom agents."""

    __tablename__ = "agent_definitions"

    id = db.Column(db.String(64), primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    role = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, default="")
    system_prompt = db.Column(db.Text, nullable=False)
    skills = db.Column(db.JSON, default=list)
    assigned_tools = db.Column(db.JSON, default=list)
    model_tier = db.Column(db.String(30), default="default")  # default | fast | reasoning | custom
    is_builtin = db.Column(db.Boolean, default=False)
    allowed_peers = db.Column(db.JSON, default=list)  # list of peer agent IDs permitted for A2A
    is_active = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "description": self.description or "",
            "system_prompt": self.system_prompt,
            "skills": self.skills or [],
            "assigned_tools": self.assigned_tools or [],
            "model_tier": self.model_tier or "default",
            "is_builtin": bool(self.is_builtin),
            "allowed_peers": self.allowed_peers or [],
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class MCPEndpoint(db.Model):
    """Registered Model Context Protocol (MCP) tool endpoints."""

    __tablename__ = "mcp_endpoints"

    id = db.Column(db.String(64), primary_key=True, default=lambda: new_id("mcp_"))
    name = db.Column(db.String(120), nullable=False)
    endpoint_url = db.Column(db.String(512), nullable=False)
    transport = db.Column(db.String(30), default="sse")  # internal | sse | http | stdio
    auth_token = db.Column(db.String(256), nullable=True)
    status = db.Column(db.String(30), default="active")  # active | offline | error
    status_message = db.Column(db.String(255), nullable=True)
    cached_tools = db.Column(db.JSON, default=list)
    tool_count = db.Column(db.Integer, default=0)

    last_synced_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "endpoint_url": self.endpoint_url,
            "transport": self.transport or "sse",
            "auth_token": "***" if self.auth_token else None,
            "status": self.status or "active",
            "status_message": self.status_message,
            "cached_tools": self.cached_tools or [],
            "tool_count": self.tool_count or (len(self.cached_tools) if self.cached_tools else 0),
            "last_synced_at": self.last_synced_at.isoformat() if self.last_synced_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class A2AMessageLog(db.Model):
    """Audit log of Agent-to-Agent (A2A) communications."""

    __tablename__ = "a2a_messages"

    id = db.Column(db.String(64), primary_key=True, default=lambda: new_id("a2a_"))
    job_id = db.Column(db.String(36), db.ForeignKey("jobs.id"), nullable=True, index=True)
    conversation_id = db.Column(db.String(64), nullable=False, index=True)
    sender_agent = db.Column(db.String(64), nullable=False, index=True)
    recipient_agent = db.Column(db.String(64), nullable=False, index=True)
    message_type = db.Column(db.String(30), default="REQUEST")  # REQUEST | RESPONSE | DELEGATE | CHALLENGE | INFORM | BROADCAST
    intent = db.Column(db.String(120), default="")
    payload = db.Column(db.JSON, default=dict)
    correlation_id = db.Column(db.String(64), nullable=True, index=True)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "job_id": self.job_id,
            "conversation_id": self.conversation_id,
            "sender_agent": self.sender_agent,
            "recipient_agent": self.recipient_agent,
            "message_type": self.message_type,
            "intent": self.intent,
            "payload": self.payload or {},
            "correlation_id": self.correlation_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AgentMemory(db.Model):
    """Native SQLite-backed lightweight memory store for agent entities, observations, and takeaways."""

    __tablename__ = "agent_memories"

    id = db.Column(db.String(64), primary_key=True, default=lambda: new_id("mem_"))
    tenant_id = db.Column(db.String(36), nullable=False, index=True)
    entity_name = db.Column(db.String(120), nullable=False, index=True)
    category = db.Column(db.String(60), default="observation", index=True)  # observation | guidance | risk | takeaway | metric
    content = db.Column(db.Text, nullable=False)
    metadata_json = db.Column(db.JSON, default=dict)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "entity_name": self.entity_name,
            "category": self.category,
            "content": self.content,
            "metadata": self.metadata_json or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

