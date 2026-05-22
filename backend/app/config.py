from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Aivorah Multi-Curriculum Knowledge Base"
    environment: str = "local"
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"

    database_url: str = "sqlite+aiosqlite:///./knowledge_base.db"

    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "aivorah_curriculum_chunks_v1"
    embedding_dimension: int = 384

    openai_api_key: str = Field(default="", repr=False)
    gemini_api_key: str = Field(default="", repr=False)
    embedding_model: str = "text-embedding-3-small"
    llm_model: str = "gpt-4.1"
    llm_temperature: float = 0.2

    cors_origins: List[str] = ["http://localhost:3000", "http://localhost:8081"]
    max_ingest_chars: int = 300_000
    default_search_limit: int = 8

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()

