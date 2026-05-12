from app.schemas.retrieval import RetrievalRequest, RetrievalResponse, RetrievedChunk
from app.services.embedding_service import EmbeddingService
from app.services.qdrant_service import QdrantService


class RetrievalService:
    def __init__(self, embeddings: EmbeddingService, qdrant: QdrantService):
        self.embeddings = embeddings
        self.qdrant = qdrant

    async def retrieve(self, request: RetrievalRequest) -> RetrievalResponse:
        vector = await self.embeddings.embed_query(request.query)
        filters = request.filters.model_dump(exclude_none=True)
        if curricula := filters.get("curricula"):
            filters["curricula"] = [str(item) for item in curricula]
        for key in ["difficulty", "bloom_taxonomy"]:
            if value := filters.get(key):
                filters[key] = str(value)
        results = await self.qdrant.search(vector, filters, request.limit)
        chunks = [
            RetrievedChunk(
                id=str(point.id),
                score=float(point.score),
                text=(point.payload or {}).get("text", ""),
                metadata={key: value for key, value in (point.payload or {}).items() if key != "text"},
            )
            for point in results
        ]
        return RetrievalResponse(query=request.query, results=chunks)
