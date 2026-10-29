"""Agent-to-Agent (A2A) Protocol specifications.

Defines standard message envelopes, peer discovery mechanisms, and intent
categories for inter-agent communication, collaborative reasoning, and delegation.
"""
from __future__ import annotations

from enum import Enum
from typing import Any
from pydantic import BaseModel, Field

from app.utils.ids import new_id


class A2AMessageType(str, Enum):
    REQUEST = "REQUEST"        # Peer requesting data, calculation, or explanation
    RESPONSE = "RESPONSE"      # Peer returning answer or findings
    DELEGATE = "DELEGATE"      # Delegating a sub-goal or specialized analysis
    CHALLENGE = "CHALLENGE"    # Verifier or reviewer challenging a peer's assertion
    INFORM = "INFORM"          # Unsolicited update or advisory notice
    BROADCAST = "BROADCAST"    # Notice broadcasted to all registered agents in job context


class A2AIntent(str, Enum):
    EXPLAIN = "explain"
    VERIFY = "verify"
    CALCULATE = "calculate"
    QUERY_FACTS = "query_facts"
    DISCOVER = "discover"
    AUDIT = "audit"
    SYNTHESIZE = "synthesize"
    GENERAL = "general"


class A2ACapability(BaseModel):
    agent_id: str
    name: str
    role: str
    skills: list[str] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list)
    description: str = ""


class A2AMessage(BaseModel):
    message_id: str = Field(default_factory=lambda: new_id("a2amsg_"))
    conversation_id: str
    job_id: str | None = None
    sender_agent: str
    recipient_agent: str  # Direct agent identifier or '*' for broadcast
    message_type: A2AMessageType = A2AMessageType.REQUEST
    intent: str = A2AIntent.GENERAL.value
    payload: dict[str, Any] = Field(default_factory=dict)
    correlation_id: str | None = None
    created_at: str | None = None


class A2AResponse(BaseModel):
    success: bool
    data: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""
    issues: list[str] = Field(default_factory=list)
