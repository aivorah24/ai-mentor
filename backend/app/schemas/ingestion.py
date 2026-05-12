from pydantic import BaseModel, Field

from app.schemas.common import CurriculumMetadata


class IngestionItem(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=300)
    text: str = Field(min_length=20)
    metadata: CurriculumMetadata


class IngestionRequest(BaseModel):
    items: list[IngestionItem] = Field(min_length=1, max_length=50)


class IngestedChunk(BaseModel):
    chunk_id: str
    qdrant_point_id: str
    chunk_index: int


class IngestionResponse(BaseModel):
    documents_ingested: int
    chunks_ingested: int
    skipped_duplicates: int
    chunks: list[IngestedChunk]

