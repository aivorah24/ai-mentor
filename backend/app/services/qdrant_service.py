from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import Distance, FieldCondition, Filter, MatchAny, MatchValue, PointStruct, VectorParams

from app.config import Settings


class QdrantService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = AsyncQdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key)

    async def ensure_collection(self) -> None:
        exists = await self.client.collection_exists(self.settings.qdrant_collection)
        if not exists:
            await self.client.create_collection(
                collection_name=self.settings.qdrant_collection,
                vectors_config=VectorParams(size=self.settings.embedding_dimension, distance=Distance.COSINE),
            )
            for field in ["curriculum", "grade", "subject", "topic", "difficulty", "bloom_taxonomy"]:
                await self.client.create_payload_index(
                    collection_name=self.settings.qdrant_collection,
                    field_name=field,
                    field_schema="keyword" if field != "grade" else "integer",
                )

    async def upsert(self, points: list[PointStruct]) -> None:
        await self.ensure_collection()
        await self.client.upsert(self.settings.qdrant_collection, points=points, wait=True)

    async def search(self, vector: list[float], filters: dict, limit: int) -> list:
        await self.ensure_collection()
        qdrant_filter = self._build_filter(filters)
        return await self.client.search(
            collection_name=self.settings.qdrant_collection,
            query_vector=vector,
            query_filter=qdrant_filter,
            limit=limit,
            with_payload=True,
        )

    def _build_filter(self, filters: dict) -> Filter | None:
        conditions: list[FieldCondition] = []
        if curricula := filters.get("curricula"):
            conditions.append(FieldCondition(key="curriculum", match=MatchAny(any=curricula)))
        for key in ["grade", "subject", "topic", "difficulty", "bloom_taxonomy"]:
            if value := filters.get(key):
                conditions.append(FieldCondition(key=key, match=MatchValue(value=value)))
        return Filter(must=conditions) if conditions else None

