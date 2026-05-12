from fastapi import APIRouter, Depends

from app.api.deps import get_orchestration_service
from app.schemas.worksheet import WorksheetRequest, WorksheetResponse
from app.services.orchestration_service import OrchestrationService

router = APIRouter()


@router.post("/generate", response_model=WorksheetResponse)
async def generate_worksheet(
    request: WorksheetRequest,
    service: OrchestrationService = Depends(get_orchestration_service),
) -> WorksheetResponse:
    return await service.generate_worksheet(request)

