"""
Smart NCERT ingestion pipeline — Grade 6-12.

Phase 1: Download chapter PDFs from ncert.nic.in
Phase 2: Extract text with PyMuPDF
Phase 3: Gemini splits raw text into semantic concept units
         { topic, explanation, key_terms, bloom_level }
Phase 4: Each concept unit -> IngestionItem -> Qdrant

Why this is better than raw chunking:
- Chunks align to teachable concepts, not random 800-char windows
- Topic and learning_objective are accurate (LLM-generated, not guessed)
- Duplicate-safe via content hash

Run:
    cd backend
    python scripts/ncert_smart_pipeline.py                         # all grades 6-12
    python scripts/ncert_smart_pipeline.py --grades 6 7            # specific grades
    python scripts/ncert_smart_pipeline.py --subjects Mathematics   # one subject
    python scripts/ncert_smart_pipeline.py --dry-run               # no Qdrant writes
    python scripts/ncert_smart_pipeline.py --phase1-only           # download + extract only
"""

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

import zipfile

import fitz          # PyMuPDF
import httpx
from cerebras.cloud.sdk import Cerebras
from google import genai as google_genai
from groq import Groq

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.api.deps import get_ingestion_service
from app.config import get_settings
from app.db.session import AsyncSessionLocal, init_db
from app.schemas.common import BloomTaxonomy, Curriculum, CurriculumMetadata, Difficulty
from app.schemas.ingestion import IngestionItem, IngestionRequest

LOGGER = logging.getLogger("ncert_smart_pipeline")

NCERT_BASE = "https://ncert.nic.in/textbook/pdf"
BASE_DIR = Path(__file__).resolve().parents[2]
DOWNLOAD_DIR = BASE_DIR / "server" / "data" / "ncert_books"
JSONL_DIR = BASE_DIR / "server" / "data" / "ncert_jsonl"

BATCH_SIZE = 20          # items per Qdrant batch
MIN_TEXT_CHARS = 200     # skip pages with less than this (headers / blank pages)
MAX_CHARS_PER_CALL = 15000   # large chunks = fewer API calls = faster with rate limits

# ---------------------------------------------------------------------------
# NCERT Book catalogue  Grade 6-12
# (grade, subject, book_code, num_chapters)
# ---------------------------------------------------------------------------
NCERT_BOOKS = [
    # Grade 6 (NEP 2020 new curriculum)
    (6,  "Mathematics",      "fegp1", 10),  # Ganita Prakash
    (6,  "Science",          "fecu1", 12),  # Curiosity
    (6,  "Social Science",   "fees1", 14),  # Exploring Society
    (6,  "English",          "fepr1", 5),   # Poorvi

    # Grade 7 (NEP 2020 new curriculum)
    (7,  "Mathematics",      "gegp1", 8),   # Ganita Prakash Part 1
    (7,  "Mathematics",      "gegp2", 7),   # Ganita Prakash Part 2
    (7,  "Science",          "gecu1", 12),  # Curiosity
    (7,  "Social Science",   "gees1", 12),  # Exploring Society Part 1
    (7,  "Social Science",   "gees2", 8),   # Exploring Society Part 2
    (7,  "English",          "gepr1", 5),   # Poorvi

    # Grade 8 (NEP 2020 new curriculum)
    (8,  "Mathematics",      "hegp1", 7),   # Ganita Prakash Part 1
    (8,  "Mathematics",      "hegp2", 7),   # Ganita Prakash Part 2
    (8,  "Science",          "hecu1", 13),  # Curiosity
    (8,  "Social Science",   "hees1", 7),   # Exploring Society
    (8,  "English",          "hepr1", 5),   # Poorvi

    # Grade 9 (current curriculum)
    (9,  "Mathematics",      "iemh1", 8),
    (9,  "Science",          "iesc1", 13),
    (9,  "Social Science",   "iess1", 23),
    (9,  "English",          "iebe1", 8),

    # Grade 10 (current curriculum)
    (10, "Mathematics",      "jemh1", 15),
    (10, "Science",          "jesc1", 15),
    (10, "Social Science",   "jess1", 7),
    (10, "Social Science",   "jess2", 5),
    (10, "Social Science",   "jess3", 5),
    (10, "English",          "jeff1", 9),
    (10, "English",          "jefp1", 9),

    # Grade 11 (current curriculum)
    (11, "Mathematics",      "kemh1", 16),
    (11, "Physics",          "keph1", 15),
    (11, "Chemistry",        "kech1", 14),
    (11, "Biology",          "kebo1", 19),
    (11, "Economics",        "keec1", 12),
    (11, "English",          "kesp1", 5),
    (11, "History",          "kehs1", 7),   # Themes in World History
    (11, "Political Science","keps1", 11),  # Political Theory
    (11, "Accountancy",      "keac1", 9),   # Part 1
    (11, "Accountancy",      "keac2", 5),   # Part 2 (computerised)
    (11, "Business Studies", "kebs1", 11),
    (11, "Computer Science", "kecs1", 7),

    # Grade 12 (current curriculum)
    (12, "Mathematics",      "lemh1", 13),
    (12, "Physics",          "leph1", 15),
    (12, "Chemistry",        "lech1", 16),
    (12, "Biology",          "lebo1", 13),
    (12, "Economics",        "leec1", 14),
    (12, "English",          "lefl1", 13),
    (12, "History",          "lehh1", 8),   # Themes in Indian History Part 1
    (12, "History",          "lehh2", 7),   # Themes in Indian History Part 2
    (12, "History",          "lehs1", 4),   # Themes in Indian History Part 3
    (12, "Political Science","leps1", 9),   # Contemporary World Politics
    (12, "Political Science","leps2", 9),   # Politics in India since Independence
    (12, "Accountancy",      "leac1", 9),   # Part 1
    (12, "Accountancy",      "leac2", 4),   # Part 2
    (12, "Business Studies", "lebs1", 6),   # Part 1
    (12, "Business Studies", "lebs2", 6),   # Part 2
    (12, "Computer Science", "lecs1", 9),
]

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_FLASH_MODEL = "gemini-2.0-flash"
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY", "")
CEREBRAS_MODEL = "llama3.1-8b"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL_PRIMARY = "llama-3.1-8b-instant"
GROQ_MODEL_FALLBACK = "llama-3.3-70b-versatile"
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY", "")
MISTRAL_MODEL_PRIMARY = "open-mistral-nemo"
MISTRAL_MODEL_FALLBACK = "open-mistral-7b"

_skip_gemini = False

BLOOM_MAP = {
    "remember": BloomTaxonomy.remember,
    "understand": BloomTaxonomy.understand,
    "apply": BloomTaxonomy.apply,
    "analyze": BloomTaxonomy.analyze,
    "analyse": BloomTaxonomy.analyze,
    "evaluate": BloomTaxonomy.evaluate,
    "create": BloomTaxonomy.create,
}

DIFFICULTY_MAP = {
    "easy": Difficulty.easy,
    "medium": Difficulty.medium,
    "hard": Difficulty.hard,
}


# ---------------------------------------------------------------------------
# Phase 1 — Download
# ---------------------------------------------------------------------------

def download_chapter(client: httpx.Client, book_code: str, chapter: int, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 2048:
        return True
    url = f"{NCERT_BASE}/{book_code}{chapter:02d}.pdf"
    for attempt in range(3):
        try:
            r = client.get(url, timeout=60, follow_redirects=True)
            if r.status_code == 200 and len(r.content) > 2048:
                dest.write_bytes(r.content)
                LOGGER.info("    Downloaded %s (%d KB)", dest.name, len(r.content) // 1024)
                return True
            if r.status_code == 404:
                return False  # chapter doesn't exist
            LOGGER.debug("    HTTP %d attempt %d: %s", r.status_code, attempt + 1, url)
        except Exception as exc:
            LOGGER.debug("    Attempt %d error %s: %s", attempt + 1, url, exc)
        time.sleep(2 ** attempt)  # exponential backoff: 1s, 2s, 4s
    LOGGER.warning("    Failed after 3 attempts: %s", url)
    return False


def try_download_zip(client: httpx.Client, book_code: str, book_dir: Path) -> list[Path]:
    """Try downloading the complete book ZIP first (faster than chapter-by-chapter)."""
    zip_url = f"{NCERT_BASE}/{book_code}dd.zip"
    zip_dest = book_dir / f"{book_code}.zip"
    if not (zip_dest.exists() and zip_dest.stat().st_size > 10240):
        try:
            r = client.get(zip_url, timeout=120, follow_redirects=True)
            if r.status_code == 200 and len(r.content) > 10240:
                zip_dest.write_bytes(r.content)
                LOGGER.info("    Downloaded ZIP %s (%d KB)", zip_dest.name, len(r.content) // 1024)
            else:
                return []
        except Exception:
            return []

    # Extract PDFs from ZIP
    pdfs = []
    try:
        with zipfile.ZipFile(zip_dest, "r") as z:
            for name in z.namelist():
                if name.lower().endswith(".pdf"):
                    dest = book_dir / Path(name).name
                    if not dest.exists():
                        dest.write_bytes(z.read(name))
                    pdfs.append(dest)
        pdfs.sort()
        LOGGER.info("    Extracted %d PDFs from ZIP", len(pdfs))
    except Exception as exc:
        LOGGER.warning("    ZIP extract error: %s", exc)
    return pdfs


def download_book(client: httpx.Client, grade: int, subject: str, book_code: str, num_chapters: int) -> list[Path]:
    book_dir = DOWNLOAD_DIR / f"grade{grade}" / subject.lower().replace(" ", "_")
    book_dir.mkdir(parents=True, exist_ok=True)

    # Try ZIP first (NCERT provides complete book ZIPs for most books)
    pdfs = try_download_zip(client, book_code, book_dir)
    if pdfs:
        return pdfs

    # Fallback: chapter by chapter
    pdfs = []
    for ch in range(1, num_chapters + 1):
        dest = book_dir / f"{book_code}{ch:02d}.pdf"
        if download_chapter(client, book_code, ch, dest):
            pdfs.append(dest)
        time.sleep(0.5)
    LOGGER.info("  Grade %d %s: %d/%d chapters", grade, subject, len(pdfs), num_chapters)
    return pdfs


# ---------------------------------------------------------------------------
# Phase 2 — Extract text
# ---------------------------------------------------------------------------

def extract_text(pdf_path: Path) -> str:
    try:
        doc = fitz.open(str(pdf_path))
        pages = []
        for page in doc:
            text = page.get_text("text").strip()
            text = re.sub(r"\n{3,}", "\n\n", text)
            text = re.sub(r" {2,}", " ", text)
            if len(text) >= MIN_TEXT_CHARS:
                pages.append(text)
        doc.close()
        return "\n\n".join(pages)
    except Exception as exc:
        LOGGER.error("  PDF read error %s: %s", pdf_path.name, exc)
        return ""


# ---------------------------------------------------------------------------
# Phase 3 — Gemini concept extraction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Extract 3-8 concept units from textbook text as JSON array. Each unit: topic (max 80 chars), explanation (2-3 sentences, student-friendly), key_terms (3-5 words), bloom_level (remember|understand|apply|analyze|evaluate|create), difficulty (easy|medium|hard). Skip exercises/activities. Return ONLY valid JSON array, no markdown."""

USER_PROMPT_TEMPLATE = """Grade: {grade}
Subject: {subject}
Chapter file: {filename}

Raw textbook text:
---
{text}
---

Extract concept units as a JSON array:
[
  {{
    "topic": "short concept name (max 80 chars)",
    "explanation": "clear 2-5 sentence explanation for a student",
    "key_terms": ["term1", "term2"],
    "bloom_level": "understand",
    "difficulty": "easy"
  }}
]"""


_gemini_client = google_genai.Client(api_key=GEMINI_API_KEY)
_cerebras_client = Cerebras(api_key=CEREBRAS_API_KEY, max_retries=0)
_groq_client = Groq(api_key=GROQ_API_KEY, max_retries=0)
_mistral_http = httpx.Client(
    base_url="https://api.mistral.ai/v1",
    headers={"Authorization": f"Bearer {MISTRAL_API_KEY}", "Content-Type": "application/json"},
    timeout=60,
)


def _parse_concepts(raw: str) -> list[dict]:
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    raw = re.sub(r"\s*```$", "", raw)
    try:
        concepts = json.loads(raw)
        if isinstance(concepts, list):
            return concepts
    except json.JSONDecodeError:
        pass
    objects = re.findall(r'\{[^{}]*?"topic"[^{}]*?"explanation"[^{}]*?\}', raw, re.DOTALL)
    salvaged = []
    for obj in objects:
        try:
            salvaged.append(json.loads(obj))
        except Exception:
            pass
    return salvaged


def _call_provider(provider: str, model: str, system: str, user_msg: str) -> list[dict] | None:
    """Call a single LLM provider. Returns parsed concepts or None on rate limit/error."""
    try:
        if provider == "cerebras":
            resp = _cerebras_client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
                temperature=0.2, max_tokens=1500,
            )
            return _parse_concepts(resp.choices[0].message.content)
        elif provider == "groq":
            resp = _groq_client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
                temperature=0.2, max_tokens=1500,
            )
            return _parse_concepts(resp.choices[0].message.content)
        elif provider == "mistral":
            r = _mistral_http.post("/chat/completions", json={
                "model": model,
                "messages": [{"role": "user", "content": system + "\n\n" + user_msg}],
                "temperature": 0.2, "max_tokens": 1500,
            })
            if r.status_code == 429:
                return None
            r.raise_for_status()
            return _parse_concepts(r.json()["choices"][0]["message"]["content"])
        else:
            return None
    except Exception as exc:
        err = str(exc)
        if "413" in err or "payload" in err.lower():
            LOGGER.warning("  %s/%s 413, retrying with truncated input", provider, model)
            try:
                half_msg = user_msg[:len(user_msg) // 2]
                if provider == "cerebras":
                    resp = _cerebras_client.chat.completions.create(
                        model=model, messages=[{"role": "system", "content": system}, {"role": "user", "content": half_msg}],
                        temperature=0.2, max_tokens=1500)
                    return _parse_concepts(resp.choices[0].message.content)
                elif provider == "mistral":
                    r2 = _mistral_http.post("/chat/completions", json={
                        "model": model,
                        "messages": [{"role": "user", "content": system + "\n\n" + half_msg}],
                        "temperature": 0.2, "max_tokens": 1500,
                    })
                    r2.raise_for_status()
                    return _parse_concepts(r2.json()["choices"][0]["message"]["content"])
                else:
                    resp = _groq_client.chat.completions.create(
                        model=model, messages=[{"role": "system", "content": system}, {"role": "user", "content": half_msg}],
                        temperature=0.2, max_tokens=1500)
                    return _parse_concepts(resp.choices[0].message.content)
            except Exception:
                return None
        elif "rate" in err.lower() or "429" in err or "RESOURCE_EXHAUSTED" in err:
            return None
        else:
            LOGGER.warning("  %s/%s error: %s", provider, model, str(exc)[:120])
            return None


# Provider rotation: Cerebras -> Groq x2 -> Mistral x2
_PROVIDERS = [
    ("cerebras", CEREBRAS_MODEL),
    ("groq", GROQ_MODEL_PRIMARY),
    ("groq", GROQ_MODEL_FALLBACK),
    ("mistral", MISTRAL_MODEL_PRIMARY),
    ("mistral", MISTRAL_MODEL_FALLBACK),
]
_provider_idx = 0


def call_gemini(grade: int, subject: str, filename: str, text: str) -> list[dict]:
    """Try providers in rotation: Cerebras -> Groq 8b -> Groq 70b."""
    global _skip_gemini, _provider_idx

    user_msg = USER_PROMPT_TEMPLATE.format(
        grade=grade, subject=subject, filename=filename,
        text=text[:MAX_CHARS_PER_CALL],
    )

    # --- Gemini (if not exhausted) ---
    if not _skip_gemini:
        try:
            resp = _gemini_client.models.generate_content(
                model=GEMINI_FLASH_MODEL,
                contents=SYSTEM_PROMPT + "\n\n" + user_msg,
                config={"temperature": 0.2, "max_output_tokens": 1500},
            )
            return _parse_concepts(resp.text)
        except Exception as exc:
            if "429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc):
                _skip_gemini = True
            else:
                LOGGER.warning("  Gemini error: %s", str(exc)[:120])

    # --- Rotate through Cerebras + Groq providers ---
    for round_num in range(3):
        for i in range(len(_PROVIDERS)):
            idx = (_provider_idx + i) % len(_PROVIDERS)
            provider, model = _PROVIDERS[idx]
            result = _call_provider(provider, model, SYSTEM_PROMPT, user_msg)
            if result is not None:
                _provider_idx = idx  # Stick with working provider
                return result
            LOGGER.info("  %s/%s rate limited, trying next...", provider, model)
            time.sleep(3)

        wait = 20 * (round_num + 1)
        LOGGER.info("  All providers rate limited (round %d). Waiting %ds...", round_num + 1, wait)
        time.sleep(wait)

    LOGGER.warning("  All providers failed for %s", filename)
    return []


def extract_concepts(pdf_path: Path, grade: int, subject: str) -> list[dict]:
    text = extract_text(pdf_path)
    if len(text) < MIN_TEXT_CHARS:
        LOGGER.warning("  Skipping %s — insufficient text (%d chars)", pdf_path.name, len(text))
        return []

    all_concepts = []
    for start in range(0, len(text), MAX_CHARS_PER_CALL - 500):
        window = text[start: start + MAX_CHARS_PER_CALL]
        if len(window) < MIN_TEXT_CHARS:
            break
        concepts = call_gemini(grade, subject, pdf_path.name, window)
        all_concepts.extend(concepts)
        if start + MAX_CHARS_PER_CALL < len(text):
            time.sleep(6.0)  # ~10 RPM to stay within Cerebras + Groq limits

    LOGGER.info("  %s -> %d concept units", pdf_path.name, len(all_concepts))
    return all_concepts


# ---------------------------------------------------------------------------
# Phase 4 — Build IngestionItems
# ---------------------------------------------------------------------------

def concepts_to_items(
    concepts: list[dict],
    grade: int,
    subject: str,
    book_code: str,
    pdf_path: Path,
) -> list[IngestionItem]:
    items = []
    file_hash = hashlib.sha256(pdf_path.name.encode()).hexdigest()[:8]
    source_base = f"ncert_g{grade}_{subject.lower().replace(' ', '_')}_{book_code}_{file_hash}"

    for idx, concept in enumerate(concepts):
        topic = str(concept.get("topic", subject))[:160]
        explanation = str(concept.get("explanation", "")).strip()
        key_terms = concept.get("key_terms", [])
        bloom_raw = str(concept.get("bloom_level", "understand")).lower()
        diff_raw = str(concept.get("difficulty", "easy")).lower()

        if len(explanation) < 20:
            continue

        bloom = BLOOM_MAP.get(bloom_raw, BloomTaxonomy.understand)
        difficulty = DIFFICULTY_MAP.get(diff_raw, Difficulty.easy)

        # Enrich text: topic + key terms + explanation
        key_terms_str = ", ".join(key_terms) if key_terms else ""
        full_text = f"{topic}\n\nKey terms: {key_terms_str}\n\n{explanation}" if key_terms_str else f"{topic}\n\n{explanation}"

        source_id = f"{source_base}_{idx:04d}"
        learning_obj = f"Students will be able to {bloom.value} concepts related to {topic} in Grade {grade} {subject}."

        item = IngestionItem(
            source_id=source_id,
            title=f"NCERT Grade {grade} {subject} | {topic[:80]}",
            text=full_text,
            metadata=CurriculumMetadata(
                curriculum=Curriculum.ncert,
                grade=grade,
                subject=subject,
                topic=topic,
                learning_objective=learning_obj,
                difficulty=difficulty,
                bloom_taxonomy=bloom,
                source_reference=f"NCERT {subject} Grade {grade} | {pdf_path.name}",
                tags=["ncert", f"grade{grade}", subject.lower().replace(" ", "_")] + [t.lower() for t in key_terms[:3]],
            ),
        )
        items.append(item)

    return items


# ---------------------------------------------------------------------------
# Ingest to Qdrant
# ---------------------------------------------------------------------------

async def _make_session():
    """Return an AsyncSession — falls back to in-memory SQLite if the file DB is locked."""
    try:
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
        from app.db.base import Base
        from app.db.session import AsyncSessionLocal
        # Quick probe — if this fails with OperationalError, use in-memory fallback
        async with AsyncSessionLocal() as probe:
            await probe.execute(__import__("sqlalchemy").text("SELECT 1"))
        return AsyncSessionLocal
    except Exception:
        LOGGER.warning("File DB locked — using in-memory SQLite for this run (Qdrant is the real store)")
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
        from app.db.base import Base
        mem_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with mem_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return async_sessionmaker(mem_engine, expire_on_commit=False, class_=AsyncSession)


async def ingest_items(items: list[IngestionItem], dry_run: bool) -> tuple[int, int, int]:
    if dry_run:
        LOGGER.info("  [DRY RUN] Would ingest %d items", len(items))
        return len(items), 0, 0

    settings = get_settings()
    service = get_ingestion_service()
    total_docs = total_chunks = total_skipped = 0

    session_factory = await _make_session()
    async with session_factory() as session:
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
# JSONL persistence (so you don't re-run Gemini if ingestion fails)
# ---------------------------------------------------------------------------

def jsonl_path_for(grade: int, subject: str, book_code: str) -> Path:
    JSONL_DIR.mkdir(parents=True, exist_ok=True)
    return JSONL_DIR / f"ncert_g{grade}_{subject.lower().replace(' ', '_')}_{book_code}.jsonl"


def save_jsonl(items: list[IngestionItem], path: Path) -> None:
    with path.open("w", encoding="utf-8") as f:
        for item in items:
            f.write(item.model_dump_json() + "\n")
    LOGGER.info("  Saved %d items to %s", len(items), path.name)


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
    parser = argparse.ArgumentParser(description="Smart NCERT Grade 6-12 ingestion pipeline.")
    parser.add_argument("--grades", type=int, nargs="+", default=list(range(6, 13)), metavar="GRADE")
    parser.add_argument("--subjects", nargs="+", help="Filter subjects e.g. Mathematics Science")
    parser.add_argument("--dry-run", action="store_true", help="Extract concepts but skip Qdrant writes.")
    parser.add_argument("--phase1-only", action="store_true", help="Download + extract to JSONL only.")
    parser.add_argument("--phase2-only", action="store_true", help="Ingest from existing JSONL files only.")
    parser.add_argument("--groq-only", action="store_true", help="Skip Gemini entirely, use only Groq.")
    return parser.parse_args()


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    args = parse_args()

    # Load API keys — Gemini key lives in server/.env
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    load_dotenv(Path(__file__).resolve().parents[2] / "server" / ".env", override=False)

    global _skip_gemini
    if args.groq_only:
        _skip_gemini = True
        LOGGER.info("--groq-only: Skipping Gemini, using Groq for all extraction.")

    grade_set = set(args.grades)
    subject_filter = {s.lower() for s in args.subjects} if args.subjects else None

    books = [
        b for b in NCERT_BOOKS
        if b[0] in grade_set and (subject_filter is None or b[1].lower() in subject_filter)
    ]

    LOGGER.info("Processing %d books for grades %s", len(books), sorted(grade_set))

    if not args.phase2_only and not args.phase1_only:
        await init_db()

    grand_docs = grand_chunks = grand_skipped = 0

    browser_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/pdf,text/html,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://ncert.nic.in/textbook.php",
    }
    with httpx.Client(headers=browser_headers, timeout=60) as http_client:
        for grade, subject, book_code, num_chapters in books:
            LOGGER.info("=== Grade %d | %s | %s ===", grade, subject, book_code)
            jsonl_file = jsonl_path_for(grade, subject, book_code)

            # --- Phase 2 only: load existing JSONL and ingest ---
            if args.phase2_only:
                if not jsonl_file.exists():
                    LOGGER.warning("  No JSONL found at %s, skipping.", jsonl_file)
                    continue
                items = load_jsonl(jsonl_file)
                LOGGER.info("  Loaded %d items from JSONL", len(items))
            else:
                # --- Skip Phase 1 if JSONL already exists (saves Gemini quota) ---
                if jsonl_file.exists() and jsonl_file.stat().st_size > 0:
                    if args.phase1_only:
                        LOGGER.info("  JSONL already exists at %s, skipping.", jsonl_file)
                        continue
                    LOGGER.info("  JSONL already exists, loading for ingest (skipping re-extraction).")
                    items = load_jsonl(jsonl_file)
                    LOGGER.info("  Loaded %d items from existing JSONL", len(items))
                else:
                    # --- Phase 1: Download ---
                    chapter_pdfs = download_book(http_client, grade, subject, book_code, num_chapters)
                    if not chapter_pdfs:
                        LOGGER.warning("  No PDFs downloaded, skipping.")
                        continue

                    # --- Phase 1: Extract concepts via Gemini ---
                    all_items: list[IngestionItem] = []
                    for pdf_path in chapter_pdfs:
                        concepts = extract_concepts(pdf_path, grade, subject)
                        items = concepts_to_items(concepts, grade, subject, book_code, pdf_path)
                        all_items.extend(items)
                        time.sleep(0.5)

                    if not all_items:
                        LOGGER.warning("  No concept units extracted for %s Grade %d.", subject, grade)
                        continue

                    # Save JSONL (so we can re-ingest without re-running Gemini)
                    save_jsonl(all_items, jsonl_file)
                    items = all_items

                    if args.phase1_only:
                        LOGGER.info("  Phase 1 done. JSONL saved. Skipping ingest.")
                        continue

            # --- Phase 3: Ingest to Qdrant ---
            LOGGER.info("  Ingesting %d concept units...", len(items))
            docs, chunks, skipped = await ingest_items(items, args.dry_run)
            grand_docs += docs
            grand_chunks += chunks
            grand_skipped += skipped
            LOGGER.info("  docs=%d chunks=%d skipped=%d", docs, chunks, skipped)

    LOGGER.info(
        "=== COMPLETE: total_docs=%d total_chunks=%d total_skipped=%d ===",
        grand_docs, grand_chunks, grand_skipped,
    )


if __name__ == "__main__":
    asyncio.run(main())
