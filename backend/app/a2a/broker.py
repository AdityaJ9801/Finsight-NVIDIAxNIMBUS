"""A2A Broker: Agent-to-Agent communication bus, routing, discovery, and audit logging."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable

from app.a2a.protocol import (
    A2ACapability,
    A2AMessage,
    A2AMessageType,
    A2AResponse,
    A2AIntent,
)
from app.extensions import db
from app.models.agent_config import A2AMessageLog, AgentDefinition

logger = logging.getLogger(__name__)


class A2ABroker:
    """Central Agent-to-Agent message bus for multi-agent coordination."""

    def __init__(self):
        self._handlers: dict[str, Callable[[A2AMessage], A2AResponse]] = {}
        self._capabilities: dict[str, A2ACapability] = {}

    def register_agent(
        self,
        agent_id: str,
        capability: A2ACapability,
        handler: Callable[[A2AMessage], A2AResponse] | None = None,
    ) -> None:
        self._capabilities[agent_id] = capability
        if handler:
            self._handlers[agent_id] = handler
        logger.debug("Registered A2A agent: %s (%s)", agent_id, capability.role)

    def unregister_agent(self, agent_id: str) -> None:
        self._capabilities.pop(agent_id, None)
        self._handlers.pop(agent_id, None)

    def discover_agents(self, skill: str | None = None) -> list[A2ACapability]:
        """Discover agents matching a required skill or return all active agents."""
        # Also sync from DB custom active agents if available
        self._sync_db_agents()

        caps = list(self._capabilities.values())
        if not skill:
            return caps
        normalized = skill.lower().replace(" ", "_")
        return [c for c in caps if any(normalized in s.lower().replace(" ", "_") for s in c.skills)]

    def get_capability(self, agent_id: str) -> A2ACapability | None:
        self._sync_db_agents()
        return self._capabilities.get(agent_id)

    def send_message(self, message: A2AMessage) -> A2AResponse:
        """Route an A2A message to its intended recipient and persist audit trail."""
        if not message.created_at:
            message.created_at = datetime.now(timezone.utc).isoformat()

        # 1. Audit log into SQLite
        self._log_message(message)

        # 2. Broadcast handling
        if message.recipient_agent in ("*", "BROADCAST"):
            recipients = [aid for aid in self._handlers if aid != message.sender_agent]
            responses = []
            for r in recipients:
                handler = self._handlers.get(r)
                if handler:
                    try:
                        res = handler(message)
                        responses.append({"agent": r, "response": res.model_dump()})
                    except Exception as e:
                        responses.append({"agent": r, "error": str(e)})
            return A2AResponse(
                success=True,
                data={"broadcast_results": responses},
                summary=f"Broadcast delivered to {len(recipients)} agents",
            )

        # 3. Direct peer message
        handler = self._handlers.get(message.recipient_agent)
        if not handler:
            # Check if this is a DB-defined custom agent and run default dynamic LLM handler
            custom_response = self._handle_custom_agent_message(message)
            if custom_response:
                return custom_response
            return A2AResponse(
                success=False,
                summary=f"Recipient agent '{message.recipient_agent}' is not currently listening or reachable",
                issues=[f"Unknown agent: {message.recipient_agent}"],
            )

        try:
            response = handler(message)
            # Log response as well if needed
            resp_msg = A2AMessage(
                conversation_id=message.conversation_id,
                job_id=message.job_id,
                sender_agent=message.recipient_agent,
                recipient_agent=message.sender_agent,
                message_type=A2AMessageType.RESPONSE,
                intent=message.intent,
                payload=response.data,
                correlation_id=message.message_id,
            )
            self._log_message(resp_msg)
            return response
        except Exception as exc:
            logger.exception("Error executing A2A handler for %s: %s", message.recipient_agent, exc)
            return A2AResponse(
                success=False,
                summary=f"Agent '{message.recipient_agent}' failed to process message: {exc}",
                issues=[str(exc)],
            )

    def _handle_custom_agent_message(self, message: A2AMessage) -> A2AResponse | None:
        """Handle execution for a user-created custom agent dynamically."""
        try:
            agent_def = AgentDefinition.query.get(message.recipient_agent)
            if not agent_def or not agent_def.is_active:
                return None

            from app.llm_gateway import get_llm_gateway
            from app.mcp.toolbox import mcp_toolbox

            llm = get_llm_gateway()
            system_prompt = agent_def.system_prompt
            prompt = (
                f"{system_prompt}\n\n"
                f"You received an Agent-to-Agent message from peer '{message.sender_agent}'.\n"
                f"Intent: {message.intent}\n"
                f"Payload: {message.payload}\n\n"
                f"Provide your analytical response, facts, and conclusions."
            )

            # Check if agent has tools assigned
            tools_context = ""
            if agent_def.assigned_tools:
                available_tools = mcp_toolbox.list_tools()
                assigned = [t for t in available_tools if t["name"] in (agent_def.assigned_tools or [])]
                if assigned:
                    tools_context = f"\nAvailable tools: {[t['name'] for t in assigned]}"

            resp = llm.complete(
                [{"role": "user", "content": prompt + tools_context}],
                tier=agent_def.model_tier or "default",
            )
            content = getattr(resp, "content", str(resp))
            return A2AResponse(
                success=True,
                data={"content": content, "agent_id": agent_def.id, "role": agent_def.role},
                summary=content[:300] if content else "Response generated",
            )
        except Exception as err:
            logger.warning("Dynamic custom agent execution failed: %s", err)
            return None

    def _sync_db_agents(self) -> None:
        """Sync custom agent definitions from SQLite into capability map."""
        try:
            custom_agents = AgentDefinition.query.filter_by(is_active=True).all()
            for ca in custom_agents:
                if ca.id not in self._capabilities:
                    self._capabilities[ca.id] = A2ACapability(
                        agent_id=ca.id,
                        name=ca.name,
                        role=ca.role,
                        skills=ca.skills or [],
                        allowed_tools=ca.assigned_tools or [],
                        description=ca.description or "",
                    )
        except Exception:
            pass

    def _log_message(self, message: A2AMessage) -> None:
        try:
            log_entry = A2AMessageLog(
                id=message.message_id,
                job_id=message.job_id,
                conversation_id=message.conversation_id,
                sender_agent=message.sender_agent,
                recipient_agent=message.recipient_agent,
                message_type=message.message_type.value if hasattr(message.message_type, "value") else str(message.message_type),
                intent=message.intent,
                payload=message.payload,
                correlation_id=message.correlation_id,
            )
            db.session.add(log_entry)
            db.session.commit()
        except Exception as err:
            db.session.rollback()
            logger.debug("Failed to record A2A message log: %s", err)


# Global singleton A2A broker instance
a2a_broker = A2ABroker()
