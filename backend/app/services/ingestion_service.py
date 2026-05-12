import uuid

from qdrant_client.http.models import PointStruct
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.curriculum import CurriculumChunk, SourceDocument
from app.schemas.ingestion import IngestedChunk, IngestionRequest, IngestionResponse
from app.services.chunking_service import ChunkingService
from app.services.embedding_service import EmbeddingService
from app.services.metadata_service import MetadataService
from app.services.qdrant_service import QdrantService
from app.services.source_policy import validate_ingestion_policy
from app.utils.text import normalize_text, stable_text_hash


class IngestionService:
    def __init__(
        self,
        chunking: ChunkingService,
        metadata: MetadataService,
        embeddings: EmbeddingService,
        qdrant: QdrantService,
    ):
        self.chunking = chunking
        self.metadata = metadata
        self.embeddings = embeddings
        self.qdrant = qdrant

    async def ingest(self, request: IngestionRequest, session: AsyncSession, max_chars: int) -> IngestionResponse:
        total_chunks = 0
        skipped = 0
        ingested_chunks: list[IngestedChunk] = []

        for item in request.items:
            validate_ingestion_policy(item.metadata.curriculum.value, item.metadata.license_status)
            cleaned = normalize_text(item.text)
            if len(cleaned) > max_chars:
                cleaned = cleaned[:max_chars]

            content_hash = stable_text_hash(cleaned)
            existing = await session.scalar(select(SourceDocument).where(SourceDocument.content_hash == content_hash))
            if existing:
                skipped += 1
                continue

            document = SourceDocument(
                source_id=item.source_id,
                title=item.title,
                content_hash=content_hash,
                license_status=item.metadata.license_status,
                metadata_json=item.metadata.payload(),
            )
            session.add(document)
            await session.flush()

            chunks = self.chunking.split(cleaned)
            vectors = await self.embeddings.embed_texts(chunks)
            points: list[PointStruct] = []

            for index, (chunk_text, vector) in enumerate(zip(chunks, vectors, strict=True)):
                point_id = str(uuid.uuid4())
                chunk_id = str(uuid.uuid4())
                payload = self.metadata.enrich(item.metadata, source_id=item.source_id, title=item.title, chunk_index=index)
                payload["text"] = chunk_text
                chunk = CurriculumChunk(
                    id=chunk_id,
                    document_id=document.id,
                    qdrant_point_id=point_id,
                    chunk_index=index,
                    text_hash=stable_text_hash(chunk_text),
                    chunk_text=chunk_text,
                    metadata_json=payload,
                )
                session.add(chunk)
                points.append(PointStruct(id=point_id, vector=vector, payload=payload))
                ingested_chunks.append(
                    IngestedChunk(chunk_id=chunk_id, qdrant_point_id=point_id, chunk_index=index)
                )

            if points:
                await self.qdrant.upsert(points)
            total_chunks += len(chunks)

        await session.commit()
        return IngestionResponse(
            documents_ingested=len(request.items) - skipped,
            chunks_ingested=total_chunks,
            skipped_duplicates=skipped,
            chunks=ingested_chunks,
        )
