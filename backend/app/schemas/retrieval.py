from pydantic import BaseModel, Field

from app.schemas.common import BloomTaxonomy, Curriculum, Difficulty


class RetrievalFilters(BaseModel):
    curricula: list[Curriculum] | None = None
    grade: int | None = Field(default=None, ge=1, le=12)
    subject: str | None = None
    topic: str | None = None
    difficulty: Difficulty | None = None
    bloom_taxonomy: BloomTaxonomy | None = None


class RetrievalRequest(BaseModel):
    query: str = Field(min_length=2, max_length=1000)
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    limit: int = Field(default=8, ge=1, le=30)


class RetrievedChunk(BaseModel):
    id: str
    score: float
    text: str
    metadata: dict


class RetrievalResponse(BaseModel):
    query: str
    results: list[RetrievedChunk]


class BuiltContextResponse(BaseModel):
    query: str
    context: str
    chunks: list[RetrievedChunk]
    curricula_covered: list[str]

