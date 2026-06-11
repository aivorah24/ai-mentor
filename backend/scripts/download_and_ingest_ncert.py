"""
Downloads NCERT textbook PDFs (Grade 6-12) from ncert.nic.in and ingests them into Qdrant.

NCERT textbooks are open/free under government of India. Each book is split into
chapters; this script downloads each chapter PDF, merges pages, and ingests.

Run:
    python scripts/download_and_ingest_ncert.py
    python scripts/download_and_ingest_ncert.py --grades 6 7 8
    python scripts/download_and_ingest_ncert.py --dry-run
    python scripts/download_and_ingest_ncert.py --download-only   (save PDFs, skip ingest)
"""

import argparse
import asyncio
import hashlib
import logging
import re
import sys
import time
from pathlib import Path

import httpx
import fitz  # PyMuPDF

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.api.deps import get_ingestion_service
from app.config import get_settings
from app.db.session import AsyncSessionLocal, init_db
from app.schemas.common import Curriculum, CurriculumMetadata
from app.schemas.ingestion import IngestionItem, IngestionRequest

LOGGER = logging.getLogger("download_and_ingest_ncert")

NCERT_BASE = "https://ncert.nic.in/textbook/pdf"
DOWNLOAD_DIR = Path(__file__).resolve().parents[2] / "server" / "data" / "ncert_books"

CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
MIN_CHUNK_CHARS = 80
BATCH_SIZE = 20

# ---------------------------------------------------------------------------
# NCERT book catalogue  Grade 6-12
# Each entry: (grade, subject, book_code, num_chapters)
# URL pattern: https://ncert.nic.in/textbook/pdf/{code}{chapter:02d}.pdf
# ---------------------------------------------------------------------------

NCERT_BOOKS = [
    # Grade 6
    (6,  "Mathematics",      "femh1", 14),
    (6,  "Science",          "fesc1", 16),
    (6,  "Social Science",   "fess1", 9),   # Our Pasts (History)
    (6,  "Social Science",   "fess2", 9),   # The Earth Our Habitat (Geography)
    (6,  "Social Science",   "fess3", 9),   # Social and Political Life (Civics)
    (6,  "English",          "fefl1", 10),  # A Pact with the Sun
    (6,  "Hindi",            "fhhw1", 17),  # Vasant

    # Grade 7
    (7,  "Mathematics",      "gemh1", 15),
    (7,  "Science",          "gesc1", 18),
    (7,  "Social Science",   "gess1", 10),  # Our Pasts II
    (7,  "Social Science",   "gess2", 10),  # Our Environment
    (7,  "Social Science",   "gess3", 9),   # Social and Political Life II
    (7,  "English",          "gefl1", 10),  # An Alien Hand
    (7,  "Hindi",            "ghcw1", 20),  # Vasant II

    # Grade 8
    (8,  "Mathematics",      "hemh1", 16),
    (8,  "Science",          "hesc1", 18),
    (8,  "Social Science",   "hess1", 12),  # Our Pasts III
    (8,  "Social Science",   "hess2", 6),   # Resources and Development
    (8,  "Social Science",   "hess3", 10),  # Social and Political Life III
    (8,  "English",          "hefl1", 10),  # It So Happened
    (8,  "Hindi",            "hhcw1", 18),  # Vasant III

    # Grade 9
    (9,  "Mathematics",      "iemh1", 8),   # Part 1
    (9,  "Mathematics",      "iemh2", 7),   # Part 2
    (9,  "Science",          "iesc1", 15),
    (9,  "Social Science",   "iess1", 5),   # India and the Contemporary World I
    (9,  "Social Science",   "iess2", 6),   # Contemporary India I
    (9,  "Social Science",   "iess3", 5),   # Democratic Politics I
    (9,  "Social Science",   "iess4", 4),   # Economics
    (9,  "English",          "iefl1", 11),  # Beehive
    (9,  "Hindi",            "ihcw1", 17),  # Kshitij

    # Grade 10
    (10, "Mathematics",      "jemh1", 8),   # Part 1
    (10, "Mathematics",      "jemh2", 7),   # Part 2
    (10, "Science",          "jesc1", 16),
    (10, "Social Science",   "jess1", 5),   # India and the Contemporary World II
    (10, "Social Science",   "jess2", 7),   # Contemporary India II
    (10, "Social Science",   "jess3", 8),   # Democratic Politics II
    (10, "Social Science",   "jess4", 5),   # Understanding Economic Development
    (10, "English",          "jefl1", 11),  # First Flight
    (10, "Hindi",            "jhcw1", 17),  # Kshitij II

    # Grade 11
    (11, "Mathematics",      "kemh1", 7),   # Part 1
    (11, "Mathematics",      "kemh2", 6),   # Part 2
    (11, "Physics",          "keph1", 8),   # Part 1
    (11, "Physics",          "keph2", 7),   # Part 2
    (11, "Chemistry",        "kech1", 7),   # Part 1
    (11, "Chemistry",        "kech2", 7),   # Part 2
    (11, "Biology",          "kebo1", 22),
    (11, "English",          "kefl1", 8),   # Hornbill
    (11, "Hindi",            "khcw1", 18),  # Aroh

    # Grade 12
    (12, "Mathematics",      "lemh1", 6),   # Part 1
    (12, "Mathematics",      "lemh2", 7),   # Part 2
    (12, "Physics",          "leph1", 8),   # Part 1
    (12, "Physics",          "leph2", 7),   # Part 2
    (12, "Chemistry",        "lech1", 8),   # Part 1
    (12, "Chemistry",        "lech2", 8),   # Part 2
    (12, "Biology",          "lebo1", 16),
    (12, "English",          "lefl1", 8),   # Flamingo
    (12, "Hindi",            "lhcw1", 18),  # Aroh II
]


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def chapter_url(book_code: str, chapter: int) -> str:
    return f"{NCERT_BASE}/{book_code}{chapter:02d}.pdf"


def download_chapter(client: httpx.Client, url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 1024:
        LOGGER.debug("  Already downloaded: %s", dest.name)
        return True
    try:
        r = client.get(url, timeout=30, follow_redirects=True)
        if r.status_code == 200 and len(r.content) > 1024:
            dest.write_bytes(r.content)
            LOGGER.info("  Downloaded: %s (%d KB)", dest.name, len(r.content) // 1024)
            return True
        else:
            LOGGER.debug("  Not found (HTTP %d): %s", r.status_code, url)
            return False
    except Exception as exc:
        LOGGER.warning("  Error downloading %s: %s", url, exc)
        return False


def download_book(
    grade: int,
    subject: str,
    book_code: str,
    num_chapters: int,
    client: httpx.Client,
) -> list[Path]:
    book_dir = DOWNLOAD_DIR / f"grade{grade}" / subject.lower().replace(" ", "_")
    book_dir.mkdir(parents=True, exist_ok=True)

    downloaded = []
    for ch in range(1, num_chapters + 1):
        url = chapter_url(book_code, ch)
        dest = book_dir / f"{book_code}{ch:02d}.pdf"
        if download_chapter(client, url, dest):
            downloaded.append(dest)
        time.sleep(0.3)  # polite delay

    LOGGER.info(
        "Grade %d %s (%s): %d/%d chapters downloaded",
        grade, subject, book_code, len(downloaded), num_chapters,
    )
    return downloaded


# ---------------------------------------------------------------------------
# Text extraction + chunking (same as ingest_ncert_pdfs.py)
# ---------------------------------------------------------------------------

CHAPTER_RE = re.compile(
    r"chapter\s+(\d+)[:\s\-\u2013\u2014]+([^\n]{3,80})", re.IGNORECASE
)


def extract_pages(pdf_path: Path) -> list[dict]:
    pages = []
    try:
        doc = fitz.open(str(pdf_path))
        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            text = re.sub(r"\n{3,}", "\n\n", text)
            text = re.sub(r" {2,}", " ", text)
            if len(text) >= MIN_CHUNK_CHARS:
                pages.append({"page": page_num, "text": text})
        doc.close()
    except Exception as exc:
        LOGGER.error("  Failed reading %s: %s", pdf_path.name, exc)
    return pages


def chunk_text(text: str) -> list[str]:
    if len(text) <= CHUNK_SIZE:
        return [text.strip()] if len(text.strip()) >= MIN_CHUNK_CHARS else []
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        if end >= len(text):
            chunk = text[start:].strip()
            if len(chunk) >= MIN_CHUNK_CHARS:
                chunks.append(chunk)
            break
        break_pos = text.rfind("\n\n", start, end)
        if break_pos <= start + CHUNK_SIZE // 2:
            for sep in (". ", "! ", "? ", ".\n"):
                pos = text.rfind(sep, start, end)
                if pos > start + CHUNK_SIZE // 2:
                    break_pos = pos + 1
                    break
            else:
                break_pos = end
        chunk = text[start:break_pos].strip()
        if len(chunk) >= MIN_CHUNK_CHARS:
            chunks.append(chunk)
        start = max(break_pos - CHUNK_OVERLAP, start + 1)
    return chunks


def pdf_to_items(
    pdf_path: Path,
    grade: int,
    subject: str,
    book_code: str,
) -> list[IngestionItem]:
    pages = extract_pages(pdf_path)
    if not pages:
        return []

    file_hash = hashlib.sha256(pdf_path.name.encode()).hexdigest()[:8]
    source_base = f"ncert_g{grade}_{subject.lower().replace(' ', '_')}_{book_code}_{file_hash}"

    items = []
    chapter_title = None
    chunk_counter = 0

    # Try to get chapter number from filename (e.g. femh103 -> chapter 3)
    ch_match = re.search(r"(\d{2})$", pdf_path.stem)
    chapter_num = int(ch_match.group(1)) if ch_match else None

    for page_data in pages:
        page_text = page_data["text"]
        page_num = page_data["page"]

        m = CHAPTER_RE.search(page_text)
        if m:
            chapter_title = m.group(2).strip().rstrip(".")

        topic = chapter_title or (f"Chapter {chapter_num}" if chapter_num else subject)
        topic = topic[:160]
        learning_obj = f"Understand and apply concepts related to {topic} in Grade {grade} {subject}."

        for chunk in chunk_text(page_text):
            source_id = f"{source_base}_p{page_num}_c{chunk_counter}"
            item = IngestionItem(
                source_id=source_id,
                title=f"NCERT Grade {grade} {subject} | {topic[:60]}",
                text=chunk,
                metadata=CurriculumMetadata(
                    curriculum=Curriculum.ncert,
                    grade=grade,
                    subject=subject,
                    topic=topic,
                    learning_objective=learning_obj,
                    source_reference=f"NCERT {subject} Grade {grade} | {pdf_path.name} | Page {page_num}",
                    tags=["ncert", f"grade{grade}", subject.lower().replace(" ", "_")],
                ),
            )
            items.append(item)
            chunk_counter += 1

    return items


# ---------------------------------------------------------------------------
# Ingest to Qdrant
# ---------------------------------------------------------------------------

async def ingest_batch(items: list[IngestionItem], dry_run: bool) -> tuple[int, int, int]:
    if dry_run:
        LOGGER.info("[DRY RUN] Would ingest %d items", len(items))
        return len(items), 0, 0

    settings = get_settings()
    service = get_ingestion_service()
    total_docs = total_chunks = total_skipped = 0

    async with AsyncSessionLocal() as session:
        for start in range(0, len(items), BATCH_SIZE):
            batch = items[start: start + BATCH_SIZE]
            resp = await service.ingest(
                IngestionRequest(items=batch),
                session,
                max_chars=settings.max_ingest_chars,
            )
            total_docs += resp.documents_ingested
            total_chunks += resp.chunks_ingested
            total_skipped += resp.skipped_duplicates

    return total_docs, total_chunks, total_skipped


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download and ingest NCERT Grade 6-12 textbooks.")
    parser.add_argument("--grades", type=int, nargs="+", default=list(range(6, 13)),
                        metavar="GRADE", help="Grades to process (default: 6-12).")
    parser.add_argument("--subjects", nargs="+",
                        help="Filter subjects (e.g. Mathematics Science). Default: all.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Download PDFs but do not write to Qdrant.")
    parser.add_argument("--download-only", action="store_true",
                        help="Download PDFs only, skip ingestion.")
    return parser.parse_args()


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    args = parse_args()
    grade_set = set(args.grades)
    subject_filter = {s.lower() for s in args.subjects} if args.subjects else None

    books = [
        b for b in NCERT_BOOKS
        if b[0] in grade_set and (subject_filter is None or b[1].lower() in subject_filter)
    ]

    LOGGER.info("Books to process: %d", len(books))
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    if not args.download_only:
        await init_db()

    grand_total_docs = grand_total_chunks = grand_total_skipped = 0

    with httpx.Client(headers={"User-Agent": "Mozilla/5.0"}) as client:
        for grade, subject, book_code, num_chapters in books:
            LOGGER.info("=== Grade %d | %s | %s ===", grade, subject, book_code)

            # Download chapters
            chapter_pdfs = download_book(grade, subject, book_code, num_chapters, client)

            if not chapter_pdfs:
                LOGGER.warning("  No chapters downloaded for %s Grade %d, skipping.", subject, grade)
                continue

            if args.download_only:
                continue

            # Build ingestion items from each chapter PDF
            all_items: list[IngestionItem] = []
            for pdf_path in chapter_pdfs:
                items = pdf_to_items(pdf_path, grade, subject, book_code)
                all_items.extend(items)

            if not all_items:
                LOGGER.warning("  No text extracted for %s Grade %d.", subject, grade)
                continue

            LOGGER.info("  Ingesting %d chunks for %s Grade %d...", len(all_items), subject, grade)
            docs, chunks, skipped = await ingest_batch(all_items, args.dry_run)
            grand_total_docs += docs
            grand_total_chunks += chunks
            grand_total_skipped += skipped
            LOGGER.info("  Done: docs=%d chunks=%d skipped=%d", docs, chunks, skipped)

    LOGGER.info(
        "=== ALL DONE: total_docs=%d total_chunks=%d total_skipped=%d ===",
        grand_total_docs, grand_total_chunks, grand_total_skipped,
    )


if __name__ == "__main__":
    asyncio.run(main())
