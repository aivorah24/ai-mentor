from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import get_settings
from app.db.session import init_db
from app.services.qdrant_service import QdrantService
from app.utils.errors import register_exception_handlers
from app.utils.logging import configure_logging


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    configure_logging(settings)
    await init_db()
    await QdrantService(settings).ensure_collection()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description=(
            "MCP-style multi-curriculum RAG backend for Grades 1-3 first, with semantic chunks, "
            "metadata filtering, Qdrant search, LangGraph orchestration, and worksheet generation."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()

