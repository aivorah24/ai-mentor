"""
NCERT Image extraction pipeline.

For each chapter PDF:
  1. Extract images using PyMuPDF
  2. Caption each image using Groq Vision (llama-4-scout)
  3. Upload image to Cloudinary
  4. Build IngestionItem with caption text + cloudinary_url in metadata
  5. Save to JSONL (same format as text pipeline)

Run:
    python scripts/ncert_image_pipeline.py --grades 6 --subjects Science
    python scripts/ncert_image_pipeline.py --grades 6 7 8 9 10 11 12
    python scripts/ncert_image_pipeline.py --phase2-only   # ingest existing JSONL only
"""

import argparse
import asyncio
import base64
import hashlib
import io
import json
import logging
import sys
import time
from pathlib import Path

import cloudinary
import cloudinary.uploader
import fitz  # PyMuPDF
import openai

sys.path.append(str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / "server" / ".env", override=False)

import os
from app.api.deps import get_ingestion_service
from app.config import get_settings
from app.db.session import AsyncSessionLocal, init_db
from app.schemas.common import BloomTaxonomy, Curriculum, CurriculumMetadata, Difficulty
from app.schemas.ingestion import IngestionItem, IngestionRequest

LOGGER = logging.getLogger("ncert_image_pipeline")

BASE_DIR   = Path(__file__).resolve().parents[2]
DOWNLOAD_DIR = BASE_DIR / "server" / "data" / "ncert_books"
JSONL_DIR    = BASE_DIR / "server" / "data" / "ncert_image_jsonl"
INDEX_FILE   = JSONL_DIR / "ncert_images_index.json"

BATCH_SIZE = 20
MIN_IMAGE_SIZE = 8000   # bytes — skip tiny icons/decorations
MIN_IMAGE_DIM  = 120    # pixels — skip tiny images


# ---------------------------------------------------------------------------
# Phase 1 URL index — load once at startup
# ---------------------------------------------------------------------------

def load_phase1_index() -> dict:
    """
    Load ncert_images_index.json from Phase 1 upload.
    Returns a dict keyed by (grade, subject_lower, chapter, page, img_index) -> url
    """
    if not INDEX_FILE.exists():
        LOGGER.warning("Phase 1 index not found at %s — will upload to Cloudinary directly.", INDEX_FILE)
        return {}
    try:
        entries = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
        index = {}
        for e in entries:
            # img index is encoded in public_id as _i{N} suffix e.g. fegp1_ch01_p1_i0
            public_id = e.get("public_id", "")
            img_idx = 0
            if "_i" in public_id:
                try:
                    img_idx = int(public_id.rsplit("_i", 1)[-1].split(".")[0])
                except ValueError:
                    pass
            key = (
                int(e["grade"]),
                str(e["subject"]).lower().replace(" ", "_"),
                int(e["chapter"]),
                int(e["page"]),
                img_idx,
            )
            index[key] = e["url"]
        LOGGER.info("Loaded %d URLs from Phase 1 index.", len(index))
        return index
    except Exception as exc:
        LOGGER.warning("Failed to load Phase 1 index: %s — will upload directly.", exc)
        return {}


_PHASE1_INDEX: dict = {}  # populated in main()

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "r1K22qEd7o3exdCi85luR43kMqzLZ23l")
MISTRAL_VISION_MODEL = "pixtral-12b-2409"
_mistral_client = openai.OpenAI(
    api_key=MISTRAL_API_KEY,
    base_url="https://api.mistral.ai/v1",
)

# Cloudinary config
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME", "di5iq2mmb"),
    api_key=os.getenv("CLOUDINARY_API_KEY", "673933774991268"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET", "NFDTkoFJI4gEWHxnJSeRriSlpA0"),
)

NCERT_BOOKS = [
    (6,  "Mathematics",      "fegp1", 10),
    (6,  "Science",          "fecu1", 12),
    (6,  "Social Science",   "fees1", 14),
    (6,  "English",          "fepr1", 5),
    (7,  "Mathematics",      "gegp1", 8),
    (7,  "Mathematics",      "gegp2", 7),
    (7,  "Science",          "gecu1", 12),
    (7,  "Social Science",   "gees1", 12),
    (7,  "Social Science",   "gees2", 8),
    (7,  "English",          "gepr1", 5),
    (8,  "Mathematics",      "hegp1", 7),
    (8,  "Mathematics",      "hegp2", 7),
    (8,  "Science",          "hecu1", 13),
    (8,  "Social Science",   "hees1", 7),
    (8,  "English",          "hepr1", 5),
    (9,  "Mathematics",      "iemh1", 8),
    (9,  "Science",          "iesc1", 13),
    (9,  "Social Science",   "iess1", 23),
    (9,  "English",          "iebe1", 8),
    (10, "Mathematics",      "jemh1", 15),
    (10, "Science",          "jesc1", 15),
    (10, "Social Science",   "jess1", 23),
    (10, "English",          "jeeb1", 8),
    (11, "Mathematics",      "kemh1", 16),
    (11, "Physics",          "keph1", 15),
    (11, "Chemistry",        "kech1", 14),
    (11, "Biology",          "kebi1", 13),
    (11, "Economics",        "keec1", 12),
    (11, "English",          "keeb1", 10),
    (12, "Mathematics",      "lemh1", 13),
    (12, "Physics",          "leph1", 15),
    (12, "Chemistry",        "lech1", 16),
    (12, "Biology",          "lebi1", 13),
    (12, "Economics",        "leec1", 14),
    (12, "English",          "leeb1", 12),
]


# ---------------------------------------------------------------------------
# Image extraction from PDF
# ---------------------------------------------------------------------------

def extract_images_from_pdf(pdf_path: Path) -> list[dict]:
    """Extract images from PDF. Returns list of {page, index, data, ext}."""
    images = []
    try:
        doc = fitz.open(str(pdf_path))
        for page_num, page in enumerate(doc, start=1):
            for img_index, img in enumerate(page.get_images(full=True)):
                xref = img[0]
                base_image = doc.extract_image(xref)
                img_data = base_image["image"]
                img_ext = base_image["ext"]
                width = base_image.get("width", 0)
                height = base_image.get("height", 0)

                # Skip tiny images (icons, decorations, bullets)
                if len(img_data) < MIN_IMAGE_SIZE:
                    continue
                if width < MIN_IMAGE_DIM or height < MIN_IMAGE_DIM:
                    continue
                # Skip banners, rules, QR codes
                if width > 0 and height > 0:
                    ratio = max(width, height) / min(width, height)
                    if ratio > 4:
                        continue
                    # Banner/border: wide and short
                    if width > 3 * height:
                        continue
                    # QR code: near-square, small
                    if abs(width - height) < 20 and width < 200:
                        continue

                images.append({
                    "page": page_num,
                    "index": img_index,
                    "data": img_data,
                    "ext": img_ext,
                    "width": width,
                    "height": height,
                })
        doc.close()
    except Exception as exc:
        LOGGER.error("  PDF image extraction error %s: %s", pdf_path.name, exc)
    return images


# ---------------------------------------------------------------------------
# Mistral Pixtral Vision captioning
# ---------------------------------------------------------------------------

MISTRAL_SUPPORTED_FORMATS = {"jpeg", "jpg", "png", "webp", "gif", "bmp", "tiff", "heif", "avif"}

def caption_image(img_data: bytes, ext: str, grade: int, subject: str, page: int) -> str | None:
    """Send image to Mistral Pixtral Vision and get an educational caption."""
    # Convert unsupported formats (e.g. JPEG2000/jpx) to PNG
    if ext.lower() not in MISTRAL_SUPPORTED_FORMATS:
        try:
            import PIL.Image
            buf = io.BytesIO()
            PIL.Image.open(io.BytesIO(img_data)).convert("RGB").save(buf, format="PNG")
            img_data = buf.getvalue()
            ext = "png"
        except Exception as conv_err:
            LOGGER.warning("  Format conversion failed for .%s: %s — skipping", ext, conv_err)
            return None

    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    b64 = base64.b64encode(img_data).decode()
    prompt = (
        f"This image is from an NCERT Grade {grade} {subject} textbook (page {page}). "
        "Describe what this image shows in 2-3 clear sentences suitable for a student. "
        "Focus on the educational content: what concept does it illustrate, what are the labeled parts, "
        "what process or structure is shown. Be specific and accurate."
    )

    for attempt in range(4):
        try:
            resp = _mistral_client.chat.completions.create(
                model=MISTRAL_VISION_MODEL,
                messages=[{"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ]}],
                max_tokens=256,
            )
            return resp.choices[0].message.content.strip()
        except Exception as exc:
            err = str(exc).lower()
            if "429" in err or "rate" in err or "quota" in err:
                wait = 20 * (attempt + 1)
                LOGGER.info("  Mistral rate limited. Waiting %ds...", wait)
                time.sleep(wait)
            else:
                LOGGER.warning("  Mistral Vision error (attempt %d): %s", attempt + 1, exc)
                time.sleep(5)
    return None


# ---------------------------------------------------------------------------
# Cloudinary upload
# ---------------------------------------------------------------------------

def upload_to_cloudinary(img_data: bytes, public_id: str, ext: str) -> str | None:
    """Upload image to Cloudinary and return the secure URL."""
    try:
        result = cloudinary.uploader.upload(
            img_data,
            public_id=f"ncert/{public_id}",
            folder="aivorah",
            resource_type="image",
            format=ext,
            overwrite=False,
        )
        return result["secure_url"]
    except Exception as exc:
        LOGGER.warning("  Cloudinary upload error for %s: %s", public_id, exc)
        return None


# ---------------------------------------------------------------------------
# Build IngestionItems from images
# ---------------------------------------------------------------------------

def images_to_items(
    images: list[dict],
    grade: int,
    subject: str,
    book_code: str,
    pdf_path: Path,
    processed_hashes: set,
    chapter: int = 0,
) -> list[IngestionItem]:
    items = []
    file_hash = hashlib.sha256(pdf_path.name.encode()).hexdigest()[:8]
    source_base = f"ncert_img_g{grade}_{subject.lower().replace(' ', '_')}_{book_code}_{file_hash}"
    subject_key = subject.lower().replace(" ", "_")

    for img in images:
        # Deduplicate same image appearing on multiple pages
        img_hash = hashlib.md5(img["data"]).hexdigest()
        if img_hash in processed_hashes:
            continue
        processed_hashes.add(img_hash)

        page = img["page"]
        idx = img["index"]
        ext = img.get("ext", "png")

        # Look up URL from Phase 1 index — no re-upload
        phase1_key = (grade, subject_key, chapter, page, idx)
        image_url = _PHASE1_INDEX.get(phase1_key)
        if not image_url:
            LOGGER.debug("  Skipping image p%d-i%d (not in Phase 1 index)", page, idx)
            continue

        # Caption via Groq Vision
        caption = caption_image(img["data"], ext, grade, subject, page)
        if not caption:
            LOGGER.debug("  Skipping image p%d-i%d (no caption)", page, idx)
            continue
        # Skip decorative/non-educational images identified by vision model
        skip_keywords = ["qr code", "barcode", "decorative", "border", "pattern", "watermark", "logo"]
        if any(kw in caption.lower() for kw in skip_keywords):
            LOGGER.debug("  Skipping image p%d-i%d (decorative: %s)", page, idx, caption[:60])
            continue

        # Build ingestion item — text = caption, image_url from Phase 1 index
        source_id = f"{source_base}_p{page}_i{idx}"
        topic = caption[:80]  # first 80 chars as topic
        learning_obj = f"Understand the visual representation of {topic} in Grade {grade} {subject}."

        full_text = f"[IMAGE] {caption} Source: NCERT Grade {grade} {subject}, Page {page}"

        item = IngestionItem(
            source_id=source_id,
            title=f"NCERT Grade {grade} {subject} | Image | Page {page}",
            text=full_text,
            metadata=CurriculumMetadata(
                curriculum=Curriculum.ncert,
                grade=grade,
                subject=subject,
                topic=topic,
                learning_objective=learning_obj,
                source_reference=f"NCERT {subject} Grade {grade} | {pdf_path.name} | Page {page}",
                tags=["ncert", f"grade{grade}", subject.lower().replace(" ", "_"), "image"],
                image_url=image_url,
            ),
        )
        items.append(item)
        LOGGER.info("    p%d img%d -> captioned + uploaded (%dx%d)", page, idx, img.get("width", 0), img.get("height", 0))
        time.sleep(1)  # Gemini Flash — generous rate limits, 1s gap is enough

    return items


# ---------------------------------------------------------------------------
# Ingest to Qdrant
# ---------------------------------------------------------------------------

async def ingest_items(items: list[IngestionItem], dry_run: bool) -> tuple[int, int, int]:
    if dry_run:
        LOGGER.info("  [DRY RUN] Would ingest %d image items", len(items))
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
# JSONL persistence
# ---------------------------------------------------------------------------

def jsonl_path_for(grade: int, subject: str, book_code: str) -> Path:
    JSONL_DIR.mkdir(parents=True, exist_ok=True)
    return JSONL_DIR / f"ncert_img_g{grade}_{subject.lower().replace(' ', '_')}_{book_code}.jsonl"


def save_jsonl(items: list[IngestionItem], path: Path) -> None:
    with path.open("w", encoding="utf-8") as f:
        for item in items:
            f.write(item.model_dump_json() + "\n")
    LOGGER.info("  Saved %d image items to %s", len(items), path.name)


def load_jsonl(path: Path) -> list[IngestionItem]:
    items = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(IngestionItem.model_validate_json(line))
    return items


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="NCERT image extraction + captioning + Cloudinary + Qdrant pipeline.")
    parser.add_argument("--grades", type=int, nargs="+", default=list(range(6, 13)))
    parser.add_argument("--subjects", nargs="+")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--phase2-only", action="store_true", help="Ingest existing image JSONL only.")
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

    global _PHASE1_INDEX
    _PHASE1_INDEX = load_phase1_index()

    await init_db()
    grand_docs = grand_chunks = grand_skipped = 0

    for grade, subject, book_code, num_chapters in books:
        LOGGER.info("=== Grade %d | %s | %s ===", grade, subject, book_code)
        jsonl_file = jsonl_path_for(grade, subject, book_code)

        if args.phase2_only:
            if not jsonl_file.exists():
                LOGGER.warning("  No image JSONL found, skipping.")
                continue
            items = load_jsonl(jsonl_file)
            LOGGER.info("  Loaded %d image items from JSONL", len(items))
        else:
            # Find downloaded PDFs for this book
            book_dir = DOWNLOAD_DIR / f"grade{grade}" / subject.lower().replace(" ", "_")
            chapter_pdfs = sorted(book_dir.glob(f"{book_code}*.pdf")) if book_dir.exists() else []

            if not chapter_pdfs:
                LOGGER.warning("  No PDFs found in %s — run text pipeline first to download.", book_dir)
                continue

            all_items: list[IngestionItem] = []
            processed_hashes: set = set()

            for pdf_path in chapter_pdfs:
                # Extract chapter number from filename e.g. fecu112.pdf → 12
                ch_str = pdf_path.stem[len(book_code):]
                chapter_num = int(ch_str) if ch_str.isdigit() else 0

                LOGGER.info("  Extracting images from %s (ch%d)...", pdf_path.name, chapter_num)
                images = extract_images_from_pdf(pdf_path)
                LOGGER.info("  Found %d usable images", len(images))

                if not images:
                    continue

                items = images_to_items(images, grade, subject, book_code, pdf_path, processed_hashes, chapter=chapter_num)
                all_items.extend(items)

            if not all_items:
                LOGGER.info("  No image items for %s Grade %d.", subject, grade)
                continue

            save_jsonl(all_items, jsonl_file)
            items = all_items

        LOGGER.info("  Ingesting %d image items into Qdrant...", len(items))
        docs, chunks, skipped = await ingest_items(items, args.dry_run)
        grand_docs += docs
        grand_chunks += chunks
        grand_skipped += skipped
        LOGGER.info("  docs=%d chunks=%d skipped=%d", docs, chunks, skipped)

    LOGGER.info("=== DONE: docs=%d chunks=%d skipped=%d ===", grand_docs, grand_chunks, grand_skipped)


if __name__ == "__main__":
    asyncio.run(main())
