"""World route aggregator preserving the original public router entrypoint."""

from fastapi import APIRouter

from server.routes.world_execution import (
    ALL_BUILTIN_TOOLS,
    DEFAULT_BUILTIN_TOOLS,
)
from server.routes.world_execution import (
    router as execution_router,
)
from server.routes.world_files import router as files_router
from server.routes.world_models import (
    CreateProjectRequest,
    SetExecutionRequest,
    SetGoalRequest,
    SwitchProjectRequest,
    UpdateProjectRequest,
    UpdateThreadSettingsRequest,
)
from server.routes.world_projects import router as projects_router
from server.routes.world_workflows import router as workflows_router

router = APIRouter()
router.include_router(projects_router)
router.include_router(execution_router)
router.include_router(workflows_router)
router.include_router(files_router)

__all__ = [
    "ALL_BUILTIN_TOOLS",
    "DEFAULT_BUILTIN_TOOLS",
    "CreateProjectRequest",
    "SetExecutionRequest",
    "SetGoalRequest",
    "SwitchProjectRequest",
    "UpdateProjectRequest",
    "UpdateThreadSettingsRequest",
    "router",
]
