import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError

from app.api.deps import get_ingestion_service
from app.config import get_settings
from app.db.session import AsyncSessionLocal, init_db
from app.schemas.ingestion import IngestionItem, IngestionRequest

LOGGER = logging.getLogger("bulk_ingest_jsonl")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bulk ingest curriculum semantic references into Qdrant.")
    parser.add_argument("--file", required=True, help="Path to a JSONL file. Each line must match IngestionItem.")
    parser.add_argument("--batch-size", type=int, default=20, help="Items per ingestion batch.")
    parser.add_argument("--dry-run", action="store_true", help="Validate input without embedding or writing.")
    return parser.parse_args()


def load_items(path: Path) -> list[IngestionItem]:
    items: list[IngestionItem] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                payload: dict[str, Any] = json.loads(stripped)
                items.append(IngestionItem.model_validate(payload))
            except (json.JSONDecodeError, ValidationError) as exc:
                raise ValueError(f"Invalid JSONL record at {path}:{line_number}: {exc}") from exc
    return items


async def ingest_items(items: list[IngestionItem], batch_size: int) -> None:
    settings = get_settings()
    await init_db()
    service = get_ingestion_service()
    total_documents = 0
    total_chunks = 0
    total_skipped = 0

    async with AsyncSessionLocal() as session:
        for start in range(0, len(items), batch_size):
            batch = items[start : start + batch_size]
            response = await service.ingest(
                IngestionRequest(items=batch),
                session,
                max_chars=settings.max_ingest_chars,
            )
            total_documents += response.documents_ingested
            total_chunks += response.chunks_ingested
            total_skipped += response.skipped_duplicates
            LOGGER.info(
                "Batch %s-%s: documents=%s chunks=%s skipped=%s",
                start + 1,
                start + len(batch),
                response.documents_ingested,
                response.chunks_ingested,
                response.skipped_duplicates,
            )

    LOGGER.info("Done: documents=%s chunks=%s skipped=%s", total_documents, total_chunks, total_skipped)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    path = Path(args.file)
    items = load_items(path)
    LOGGER.info("Loaded %s records from %s", len(items), path)
    if args.dry_run:
        LOGGER.info("Dry run passed. No embeddings or writes performed.")
        return
    await ingest_items(items, args.batch_size)


if __name__ == "__main__":
    asyncio.run(main())
