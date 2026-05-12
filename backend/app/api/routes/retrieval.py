from fastapi import APIRouter, Depends

from app.api.deps import get_context_builder_service, get_retrieval_service
from app.schemas.retrieval import BuiltContextResponse, RetrievalRequest, RetrievalResponse
from app.services.context_builder_service import ContextBuilderService
from app.services.retrieval_service import RetrievalService

router = APIRouter()


@router.post("/search", response_model=RetrievalResponse)
async def semantic_search(
    request: RetrievalRequest,
    service: RetrievalService = Depends(get_retrieval_service),
) -> RetrievalResponse:
    return await service.retrieve(request)


@router.post("/context", response_model=BuiltContextResponse)
async def build_context(
    request: RetrievalRequest,
    retrieval: RetrievalService = Depends(get_retrieval_service),
    context_builder: ContextBuilderService = Depends(get_context_builder_service),
) -> BuiltContextResponse:
    results = await retrieval.retrieve(request)
    return context_builder.build(results)

