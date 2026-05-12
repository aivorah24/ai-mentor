from functools import lru_cache

from app.config import Settings, get_settings
from app.services.chunking_service import ChunkingService
from app.services.context_builder_service import ContextBuilderService
from app.services.embedding_service import EmbeddingService
from app.services.ingestion_service import IngestionService
from app.services.llm_service import LLMService
from app.services.metadata_service import MetadataService
from app.services.orchestration_service import OrchestrationService
from app.services.qdrant_service import QdrantService
from app.services.retrieval_service import RetrievalService
from app.services.simplification_service import SimplificationService
from app.services.validation_service import ValidationService
from app.services.worksheet_generator_service import WorksheetGeneratorService


@lru_cache
def get_qdrant_service() -> QdrantService:
    return QdrantService(get_settings())


@lru_cache
def get_embedding_service() -> EmbeddingService:
    return EmbeddingService(get_settings())


@lru_cache
def get_llm_service() -> LLMService:
    return LLMService(get_settings())


def get_ingestion_service() -> IngestionService:
    return IngestionService(
        chunking=ChunkingService(),
        metadata=MetadataService(),
        embeddings=get_embedding_service(),
        qdrant=get_qdrant_service(),
    )


def get_retrieval_service() -> RetrievalService:
    return RetrievalService(embeddings=get_embedding_service(), qdrant=get_qdrant_service())


def get_context_builder_service() -> ContextBuilderService:
    return ContextBuilderService()


def get_orchestration_service() -> OrchestrationService:
    llm = get_llm_service()
    return OrchestrationService(
        retrieval=get_retrieval_service(),
        context_builder=get_context_builder_service(),
        simplifier=SimplificationService(llm),
        worksheet_generator=WorksheetGeneratorService(llm),
        validator=ValidationService(llm),
    )


def get_app_settings() -> Settings:
    return get_settings()

