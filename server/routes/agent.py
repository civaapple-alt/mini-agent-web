"""Agent route aggregator preserving the original router entrypoints."""

from fastapi import APIRouter

from server.routes.agent_models import (
    ApprovalResponseRequest,
    InterruptTurnRequest,
    StartTurnRequest,
    SteerTurnRequest,
)
from server.routes.agent_turns import _process_attachments
from server.routes.agent_turns import router as turns_router
from server.routes.agent_ws import (
    _interrupt_turn_to_ws,
    _steer_turn_to_ws,
    _stream_turn_to_ws,
)
from server.routes.agent_ws import router as ws_agent_router
from server.routes.agent_ws import ws_router as ws_transport_router

router = APIRouter()
router.include_router(turns_router)
router.include_router(ws_agent_router)

ws_router = APIRouter()
ws_router.include_router(ws_transport_router)

__all__ = [
    "ApprovalResponseRequest",
    "InterruptTurnRequest",
    "StartTurnRequest",
    "SteerTurnRequest",
    "_interrupt_turn_to_ws",
    "_process_attachments",
    "_steer_turn_to_ws",
    "_stream_turn_to_ws",
    "router",
    "ws_router",
]
