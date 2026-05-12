from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_app_settings, get_ingestion_service
from app.config import Settings
from app.db.session import get_db_session
from app.schemas.ingestion import IngestionRequest, IngestionResponse
from app.services.ingestion_service import IngestionService

router = APIRouter()


@router.post("", response_model=IngestionResponse)
async def ingest_curriculum_content(
    request: IngestionRequest,
    service: IngestionService = Depends(get_ingestion_service),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> IngestionResponse:
    return await service.ingest(request, session, max_chars=settings.max_ingest_chars)

