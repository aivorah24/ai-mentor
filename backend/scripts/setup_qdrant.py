import asyncio

from app.config import get_settings
from app.services.qdrant_service import QdrantService


async def main() -> None:
    service = QdrantService(get_settings())
    await service.ensure_collection()
    print(f"Qdrant collection ready: {service.settings.qdrant_collection}")


if __name__ == "__main__":
    asyncio.run(main())

