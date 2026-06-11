"""
Automated NCERT (and future curriculum) PDF ingestion pipeline.

Usage:
    # Ingest all PDFs in a folder (auto-detect grade/subject from path/filename):
    python ingest_ncert_pdfs.py --input-dir /path/to/ncert_pdfs

    # Ingest a single PDF with explicit metadata:
    python ingest_ncert_pdfs.py --pdf /path/to/grade6_maths.pdf --grade 6 --subject Mathematics

    # Cambridge (when licensed):
    python ingest_ncert_pdfs.py --input-dir /path/to/cambridge --curriculum Cambridge

    # Dry run (validate only, no writes):
    python ingest_ncert_pdfs.py --input-dir /path/to/pdfs --dry-run

    # Generate JSONL only (no ingestion — hand off to bulk_ingest_jsonl.py):
    python ingest_ncert_pdfs.py --input-dir /path/to/pdfs --jsonl-out output.jsonl

Folder structure auto-detection:
    ncert_pdfs/
        grade6/
            mathematics/   -> grade=6, subject=Mathematics
            science/       -> grade=6, subject=Science
        grade7/
            maths.pdf      -> grade=7, subject=Mathematics (from filename)

Filename auto-detection examples:
    grade6_mathematics.pdf
    class7_science_chapter1.pdf
    ncert_g8_social_science.pdf
    10th_english.pdf
"""

import argparse
import asyncio
import hashlib
import json
import logging
import re
import sys
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

# Add backend root to path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.api.deps import get_ingestion_service
from app.config import get_settings
from app.db.session import AsyncSessionLocal, init_db
from app.schemas.common import Curriculum, CurriculumMetadata
from app.schemas.ingestion import IngestionItem, IngestionRequest
from app.services.source_policy import OPEN_REFERENCE_CURRICULA, RESTRICTED_REFERENCE_CURRICULA

LOGGER = logging.getLogger("ingest_ncert_pdfs")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CHUNK_SIZE = 800       # characters per chunk (approx 150–200 words)
CHUNK_OVERLAP = 120    # overlap to preserve context across chunks
MIN_CHUNK_CHARS = 80   # discard tiny fragments (headers, page numbers)
BATCH_SIZE = 20        # items per ingestion batch

# Normalise common subject aliases to canonical names
SUBJECT_ALIASES: dict[str, str] = {
    "maths": "Mathematics",
    "math": "Mathematics",
    "mathematics": "Mathematics",
    "science": "Science",
    "physics": "Physics",
    "chemistry": "Chemistry",
    "biology": "Biology",
    "english": "English",
    "hindi": "Hindi",
    "history": "History",
    "geography": "Geography",
    "social": "Social Science",
    "social_science": "Social Science",
    "social science": "Social Science",
    "sst": "Social Science",
    "economics": "Economics",
    "civics": "Civics",
    "political_science": "Political Science",
    "political science": "Political Science",
    "sanskrit": "Sanskrit",
    "urdu": "Urdu",
    "computer": "Computer Science",
    "computer_science": "Computer Science",
    "evs": "Environmental Studies",
    "environmental": "Environmental Studies",
    "environmental studies": "Environmental Studies",
    "accountancy": "Accountancy",
    "business": "Business Studies",
    "business studies": "Business Studies",
}


def normalise_subject(raw: str) -> str:
    key = raw.lower().strip().replace("-", "_").replace(" ", "_")
    # Try multi-word first
    for alias, canonical in SUBJECT_ALIASES.items():
        if key == alias.replace(" ", "_"):
            return canonical
    return raw.strip().title()


# ---------------------------------------------------------------------------
# Grade / Subject detection from path + filename
# ---------------------------------------------------------------------------

GRADE_PATTERNS = [
    r"grade[_\-\s]?(\d{1,2})",
    r"class[_\-\s]?(\d{1,2})",
    r"g(\d{1,2})[_\-\s]",
    r"(\d{1,2})th",
    r"(\d{1,2})st",
    r"(\d{1,2})nd",
    r"(\d{1,2})rd",
]

SUBJECT_PATTERNS = [
    r"[_\-\s](mathematics|maths?|science|physics|chemistry|biology|"
    r"english|hindi|history|geography|social[_\s]?science|sst|economics|"
    r"civics|political[_\s]?science|sanskrit|urdu|computer[_\s]?science|"
    r"evs|environmental[_\s]?studies|accountancy|business[_\s]?studies)[_\-\s\.]",
]


def detect_grade(text: str) -> int | None:
    text_lower = text.lower()
    for pattern in GRADE_PATTERNS:
        m = re.search(pattern, text_lower)
        if m:
            grade = int(m.group(1))
            if 1 <= grade <= 12:
                return grade
    return None


def detect_subject(text: str) -> str | None:
    text_lower = " " + text.lower().replace("_", " ").replace("-", " ") + " "
    for pattern in SUBJECT_PATTERNS:
        m = re.search(pattern, text_lower)
        if m:
            return normalise_subject(m.group(1))
    return None


def infer_metadata_from_path(pdf_path: Path, curriculum: str) -> tuple[int | None, str | None]:
    """Try to detect grade and subject from folder path + filename."""
    # Combine parent folder names + stem for matching
    search_text = " ".join(p.name for p in pdf_path.parents[:3]) + " " + pdf_path.stem

    grade = detect_grade(search_text)
    subject = detect_subject(search_text)

    # Fallback: look at individual path parts
    if grade is None:
        for part in pdf_path.parts:
            g = detect_grade(part)
            if g:
                grade = g
                break

    if subject is None:
        for part in pdf_path.parts:
            s = detect_subject(part + " ")
            if s:
                subject = s
                break

    return grade, subject


# ---------------------------------------------------------------------------
# PDF text extraction
# ---------------------------------------------------------------------------

def extract_text_from_pdf(pdf_path: Path) -> list[dict[str, Any]]:
    """
    Extract text page by page from a PDF.
    Returns list of {"page": int, "text": str}.
    Skips pages with < MIN_CHUNK_CHARS of text (images, diagrams).
    """
    pages = []
    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        LOGGER.error("Failed to open %s: %s", pdf_path, exc)
        return pages

    for page_num, page in enumerate(doc, start=1):
        text = page.get_text("text").strip()
        # Remove excessive whitespace / blank lines
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r" {2,}", " ", text)
        if len(text) >= MIN_CHUNK_CHARS:
            pages.append({"page": page_num, "text": text})

    doc.close()
    LOGGER.info("  Extracted %d text pages from %s", len(pages), pdf_path.name)
    return pages


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into overlapping chunks on sentence/paragraph boundaries.
    Tries to break at paragraph breaks (\n\n) or sentence ends (. ! ?).
    """
    if len(text) <= chunk_size:
        return [text.strip()] if len(text.strip()) >= MIN_CHUNK_CHARS else []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        if end >= len(text):
            chunk = text[start:].strip()
            if len(chunk) >= MIN_CHUNK_CHARS:
                chunks.append(chunk)
            break

        # Try to break at paragraph
        break_pos = text.rfind("\n\n", start, end)
        if break_pos == -1 or break_pos <= start + chunk_size // 2:
            # Try sentence end
            for sep in (". ", "! ", "? ", ".\n", "!\n", "?\n"):
                pos = text.rfind(sep, start, end)
                if pos > start + chunk_size // 2:
                    break_pos = pos + 1
                    break
            else:
                break_pos = end  # hard cut

        chunk = text[start:break_pos].strip()
        if len(chunk) >= MIN_CHUNK_CHARS:
            chunks.append(chunk)
        start = max(break_pos - overlap, start + 1)

    return chunks


# ---------------------------------------------------------------------------
# Topic / learning objective extraction (heuristic)
# ---------------------------------------------------------------------------

CHAPTER_PATTERNS = [
    r"chapter\s+(\d+)[:\s\-–]+([^\n]{3,80})",
    r"unit\s+(\d+)[:\s\-–]+([^\n]{3,80})",
    r"lesson\s+(\d+)[:\s\-–]+([^\n]{3,80})",
    r"section\s+(\d+)[:\s\-–]+([^\n]{3,80})",
]


def extract_chapter_title(text: str) -> str | None:
    for pattern in CHAPTER_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(2).strip().rstrip(".")
    return None


def infer_topic(chunk: str, subject: str, chapter_title: str | None) -> str:
    if chapter_title:
        return chapter_title[:160]
    # Use first non-trivial line as topic
    for line in chunk.splitlines():
        line = line.strip()
        if len(line) > 10 and not line.isdigit():
            return line[:160]
    return subject


def infer_learning_objective(topic: str, subject: str, grade: int) -> str:
    return f"Understand and apply concepts related to {topic} in Grade {grade} {subject}."


# ---------------------------------------------------------------------------
# Build IngestionItems from a PDF
# ---------------------------------------------------------------------------

def pdf_to_ingestion_items(
    pdf_path: Path,
    grade: int,
    subject: str,
    curriculum: str,
) -> list[IngestionItem]:
    pages = extract_text_from_pdf(pdf_path)
    if not pages:
        LOGGER.warning("  No text extracted from %s, skipping.", pdf_path.name)
        return []

    # Build source_id base from file hash (first 12 chars)
    file_hash = hashlib.sha256(pdf_path.name.encode()).hexdigest()[:8]
    source_base = f"{curriculum.lower()}_g{grade}_{subject.lower().replace(' ', '_')}_{file_hash}"

    curriculum_enum = Curriculum(curriculum)
    items: list[IngestionItem] = []
    chunk_counter = 0

    # Track chapter title as we scan pages
    current_chapter: str | None = None

    for page_data in pages:
        page_text = page_data["text"]
        page_num = page_data["page"]

        # Detect chapter title from this page
        found_chapter = extract_chapter_title(page_text)
        if found_chapter:
            current_chapter = found_chapter

        chunks = chunk_text(page_text)

        for chunk in chunks:
            topic = infer_topic(chunk, subject, current_chapter)
            learning_obj = infer_learning_objective(topic, subject, grade)

            source_id = f"{source_base}_p{page_num}_c{chunk_counter}"

            meta = CurriculumMetadata(
                curriculum=curriculum_enum,
                grade=grade,
                subject=subject,
                topic=topic,
                learning_objective=learning_obj,
                source_reference=f"{pdf_path.name} | Page {page_num}",
                tags=[curriculum.lower(), f"grade{grade}", subject.lower().replace(" ", "_")],
            )

            item = IngestionItem(
                source_id=source_id,
                title=f"{subject} | Grade {grade} | {topic[:80]}",
                text=chunk,
                metadata=meta,
            )
            items.append(item)
            chunk_counter += 1

    LOGGER.info(
        "  Built %d ingestion items from %s (Grade %d %s)",
        len(items), pdf_path.name, grade, subject,
    )
    return items


# ---------------------------------------------------------------------------
# Source policy check
# ---------------------------------------------------------------------------

def check_source_policy(curriculum: str) -> None:
    try:
        Curriculum(curriculum)  # validates it's a known value
    except ValueError:
        LOGGER.error("Unknown curriculum '%s'. Valid values: %s", curriculum, [c.value for c in Curriculum])
        sys.exit(1)

    if curriculum in RESTRICTED_REFERENCE_CURRICULA:
        LOGGER.error(
            "Curriculum '%s' requires a license. "
            "Obtain a license and pass --skip-policy-check once licensed. "
            "Aborting.",
            curriculum,
        )
        sys.exit(1)


# ---------------------------------------------------------------------------
# Discover PDFs
# ---------------------------------------------------------------------------

def discover_pdfs(input_dir: Path) -> list[Path]:
    pdfs = sorted(input_dir.rglob("*.pdf"))
    LOGGER.info("Found %d PDF(s) in %s", len(pdfs), input_dir)
    return pdfs


# ---------------------------------------------------------------------------
# Ingest to Qdrant
# ---------------------------------------------------------------------------

async def ingest_items_batch(items: list[IngestionItem], dry_run: bool) -> None:
    if dry_run:
        LOGGER.info("[DRY RUN] Would ingest %d items — skipping writes.", len(items))
        return

    settings = get_settings()
    await init_db()
    service = get_ingestion_service()

    total_docs = total_chunks = total_skipped = 0

    async with AsyncSessionLocal() as session:
        for start in range(0, len(items), BATCH_SIZE):
            batch = items[start: start + BATCH_SIZE]
            response = await service.ingest(
                IngestionRequest(items=batch),
                session,
                max_chars=settings.max_ingest_chars,
            )
            total_docs += response.documents_ingested
            total_chunks += response.chunks_ingested
            total_skipped += response.skipped_duplicates
            LOGGER.info(
                "Batch %d-%d: docs=%d chunks=%d skipped=%d",
                start + 1, start + len(batch),
                response.documents_ingested, response.chunks_ingested, response.skipped_duplicates,
            )

    LOGGER.info(
        "Ingestion complete: docs=%d chunks=%d skipped=%d",
        total_docs, total_chunks, total_skipped,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Automated curriculum PDF ingestion pipeline for Aivorah.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--input-dir", type=Path, help="Folder of PDFs (recurses into subdirectories).")
    source_group.add_argument("--pdf", type=Path, help="Single PDF file to ingest.")

    parser.add_argument(
        "--curriculum",
        default="NCERT",
        choices=[c.value for c in Curriculum],
        help="Curriculum name (default: NCERT).",
    )
    parser.add_argument("--grade", type=int, choices=range(1, 13), metavar="1-12",
                        help="Override grade (auto-detected from path/filename if omitted).")
    parser.add_argument("--subject", help="Override subject (auto-detected from path/filename if omitted).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Validate and build items but do not write to Qdrant.")
    parser.add_argument("--jsonl-out", type=Path,
                        help="If set, write JSONL output here instead of (or in addition to) ingesting.")
    parser.add_argument("--skip-policy-check", action="store_true",
                        help="Skip source policy check (for licensed content that is not yet in policy).")

    return parser.parse_args()


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    args = parse_args()

    # Source policy check
    if not args.skip_policy_check:
        check_source_policy(args.curriculum)

    # Collect PDFs
    if args.pdf:
        pdfs = [args.pdf]
    else:
        pdfs = discover_pdfs(args.input_dir)

    if not pdfs:
        LOGGER.error("No PDF files found. Exiting.")
        sys.exit(1)

    all_items: list[IngestionItem] = []
    failed_pdfs: list[Path] = []

    for pdf_path in pdfs:
        LOGGER.info("Processing: %s", pdf_path)

        # Resolve grade
        grade = args.grade
        subject = args.subject

        if grade is None or subject is None:
            detected_grade, detected_subject = infer_metadata_from_path(pdf_path, args.curriculum)
            if grade is None:
                grade = detected_grade
            if subject is None:
                subject = detected_subject

        if grade is None:
            LOGGER.warning(
                "  Could not detect grade for %s. "
                "Rename file/folder to include grade (e.g., grade6_maths.pdf) or pass --grade.",
                pdf_path.name,
            )
            failed_pdfs.append(pdf_path)
            continue

        if subject is None:
            LOGGER.warning(
                "  Could not detect subject for %s. "
                "Rename file/folder to include subject or pass --subject.",
                pdf_path.name,
            )
            failed_pdfs.append(pdf_path)
            continue

        subject = normalise_subject(subject)

        try:
            items = pdf_to_ingestion_items(pdf_path, grade, subject, args.curriculum)
            all_items.extend(items)
        except Exception as exc:
            LOGGER.error("  Error processing %s: %s", pdf_path.name, exc, exc_info=True)
            failed_pdfs.append(pdf_path)

    LOGGER.info("Total items to ingest: %d from %d PDF(s)", len(all_items), len(pdfs) - len(failed_pdfs))

    if not all_items:
        LOGGER.error("No items built. Exiting.")
        sys.exit(1)

    # Write JSONL if requested
    if args.jsonl_out:
        args.jsonl_out.parent.mkdir(parents=True, exist_ok=True)
        with args.jsonl_out.open("w", encoding="utf-8") as f:
            for item in all_items:
                f.write(item.model_dump_json() + "\n")
        LOGGER.info("JSONL written to %s (%d records)", args.jsonl_out, len(all_items))

    # Ingest
    await ingest_items_batch(all_items, dry_run=args.dry_run)

    if failed_pdfs:
        LOGGER.warning("Failed PDFs (%d):", len(failed_pdfs))
        for p in failed_pdfs:
            LOGGER.warning("  %s", p)


if __name__ == "__main__":
    asyncio.run(main())
