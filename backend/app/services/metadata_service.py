from app.schemas.common import CurriculumMetadata


class MetadataService:
    def enrich(self, metadata: CurriculumMetadata, *, source_id: str, title: str, chunk_index: int) -> dict:
        payload = metadata.payload()
        payload.update(
            {
                "source_id": source_id,
                "title": title,
                "chunk_index": chunk_index,
                "content_type": "image" if metadata.image_url else "semantic_chunk",
            }
        )
        return payload

