from openai import AsyncOpenAI

from app.config import Settings
from app.utils.errors import AppError


class EmbeddingService:
    def __init__(self, settings: Settings):
        if not settings.openai_api_key:
            raise AppError("OPENAI_API_KEY is required for embeddings.", status_code=500, code="missing_openai_key")
        self.settings = settings
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        response = await self.client.embeddings.create(
            model=self.settings.embedding_model,
            input=texts,
        )
        return [item.embedding for item in response.data]

    async def embed_query(self, query: str) -> list[float]:
        return (await self.embed_texts([query]))[0]

