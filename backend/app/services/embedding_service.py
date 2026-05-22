import asyncio
import logging

from sentence_transformers import SentenceTransformer

from app.config import Settings

LOGGER = logging.getLogger(__name__)

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"  # 384-dim, free, runs locally, no quota
BATCH_SIZE = 256


class EmbeddingService:
    _model: SentenceTransformer | None = None

    def __init__(self, settings: Settings):
        # Lazy-load model on first use (downloads once, cached locally)
        if EmbeddingService._model is None:
            LOGGER.info("Loading sentence-transformers model %s...", EMBEDDING_MODEL_NAME)
            EmbeddingService._model = SentenceTransformer(EMBEDDING_MODEL_NAME)
            LOGGER.info("Model loaded. Embedding dim: %d", EmbeddingService._model.get_sentence_embedding_dimension())

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        vectors = EmbeddingService._model.encode(texts, batch_size=BATCH_SIZE, show_progress_bar=False)
        return [v.tolist() for v in vectors]

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        loop = asyncio.get_event_loop()
        results = []
        for i in range(0, len(texts), BATCH_SIZE):
            batch = texts[i: i + BATCH_SIZE]
            batch_results = await loop.run_in_executor(None, self._embed_batch, batch)
            results.extend(batch_results)
        return results

    async def embed_query(self, query: str) -> list[float]:
        return (await self.embed_texts([query]))[0]
