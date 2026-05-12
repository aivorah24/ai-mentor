from fastapi import APIRouter, Depends

from app.api.deps import get_qdrant_service
from app.services.qdrant_service import QdrantService

router = APIRouter()


@router.post("/qdrant/setup")
async def setup_qdrant(qdrant: QdrantService = Depends(get_qdrant_service)) -> dict:
    await qdrant.ensure_collection()
    return {"status": "ready", "collection": qdrant.settings.qdrant_collection}

