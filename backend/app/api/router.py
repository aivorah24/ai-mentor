from fastapi import APIRouter

from app.api.routes import admin, health, ingestion, retrieval, worksheets

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(ingestion.router, prefix="/ingestion", tags=["ingestion"])
api_router.include_router(retrieval.router, prefix="/retrieval", tags=["retrieval"])
api_router.include_router(worksheets.router, prefix="/worksheets", tags=["worksheets"])

