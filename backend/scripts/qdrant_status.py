"""
Qdrant + Pipeline Status Dashboard

Shows:
  - All Qdrant collections and point counts
  - Per-grade, per-subject breakdown of what's in Qdrant
  - JSONL files ready for ingestion (Phase 1 done, Phase 2 pending)
  - Downloaded PDFs per grade

Run:
    python scripts/qdrant_status.py
"""

import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

BASE_DIR = Path(__file__).resolve().parents[2]
DOWNLOAD_DIR = BASE_DIR / "server" / "data" / "ncert_books"
JSONL_DIR    = BASE_DIR / "server" / "data" / "ncert_jsonl"

QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "aivorah_curriculum_chunks_v1")

SUBJECTS_ORDER = ["Mathematics", "Science", "Social Science", "Physics",
                  "Chemistry", "Biology", "Economics", "English", "Hindi"]

def bar(n, max_n, width=20):
    filled = int(width * n / max_n) if max_n else 0
    return "[" + "#" * filled + "-" * (width - filled) + "]"

def fmt(n):
    return f"{n:,}"

def main():
    client = QdrantClient(
        url=os.getenv("QDRANT_URL"),
        api_key=os.getenv("QDRANT_API_KEY"),
    )

    print("=" * 60)
    print("  AIVORAH KNOWLEDGE BASE — STATUS DASHBOARD")
    print("=" * 60)

    # ── 1. All Collections ──────────────────────────────────────
    print("\n[ QDRANT COLLECTIONS ]")
    collections = client.get_collections().collections
    if not collections:
        print("  No collections found.")
    for c in collections:
        info = client.get_collection(c.name)
        marker = " <-- curriculum KB" if c.name == QDRANT_COLLECTION else ""
        print(f"  {c.name:45s} {fmt(info.points_count):>8} points{marker}")

    # ── 2. Curriculum KB breakdown ──────────────────────────────
    collection_exists = any(c.name == QDRANT_COLLECTION for c in collections)
    print(f"\n[ CURRICULUM KB: {QDRANT_COLLECTION} ]")

    if not collection_exists:
        print("  Collection does not exist yet. Run the ingestion pipeline first.")
        print("  Command: python scripts/ncert_smart_pipeline.py --phase2-only")
    else:
        total = client.get_collection(QDRANT_COLLECTION).points_count
        print(f"  Total chunks: {fmt(total)}\n")

        grade_totals = {}
        subject_by_grade = {}

        for grade in range(1, 13):
            result = client.count(
                collection_name=QDRANT_COLLECTION,
                count_filter=Filter(must=[
                    FieldCondition(key="grade", match=MatchValue(value=grade))
                ]),
            )
            if result.count == 0:
                continue
            grade_totals[grade] = result.count
            subject_by_grade[grade] = {}

            for subject in SUBJECTS_ORDER:
                r2 = client.count(
                    collection_name=QDRANT_COLLECTION,
                    count_filter=Filter(must=[
                        FieldCondition(key="grade",   match=MatchValue(value=grade)),
                        FieldCondition(key="subject", match=MatchValue(value=subject)),
                    ]),
                )
                if r2.count > 0:
                    subject_by_grade[grade][subject] = r2.count

        max_grade_total = max(grade_totals.values()) if grade_totals else 1
        for grade in sorted(grade_totals):
            count = grade_totals[grade]
            print(f"  Grade {grade:2d}  {bar(count, max_grade_total)}  {fmt(count):>7} chunks")
            for subject, sc in subject_by_grade[grade].items():
                print(f"           {'':20s}  {subject:<20s} {fmt(sc):>6}")

    # ── 3. JSONL files (Phase 1 done, pending ingestion) ────────
    print("\n[ JSONL FILES (Phase 1 complete — ready to ingest) ]")
    if not JSONL_DIR.exists() or not list(JSONL_DIR.glob("*.jsonl")):
        print("  No JSONL files found. Phase 1 not complete yet.")
    else:
        jsonl_files = sorted(JSONL_DIR.glob("*.jsonl"))
        total_items = 0
        for f in jsonl_files:
            lines = sum(1 for line in f.open(encoding="utf-8") if line.strip())
            total_items += lines
            print(f"  {f.name:<55s} {lines:>5} concepts")
        print(f"  {'TOTAL':<55s} {total_items:>5} concepts")

    # ── 4. Downloaded PDFs ──────────────────────────────────────
    print("\n[ DOWNLOADED PDFs (Phase 1 in progress) ]")
    if not DOWNLOAD_DIR.exists():
        print("  No PDFs downloaded yet.")
    else:
        total_pdfs = 0
        total_mb = 0
        for grade_dir in sorted(DOWNLOAD_DIR.iterdir()):
            if not grade_dir.is_dir():
                continue
            grade_pdfs = list(grade_dir.rglob("*.pdf"))
            grade_mb = sum(f.stat().st_size for f in grade_pdfs) / (1024 * 1024)
            if grade_pdfs:
                print(f"  {grade_dir.name:<12s} {len(grade_pdfs):>3} PDFs   {grade_mb:6.1f} MB")
                total_pdfs += len(grade_pdfs)
                total_mb += grade_mb
        print(f"  {'TOTAL':<12s} {total_pdfs:>3} PDFs   {total_mb:6.1f} MB")

    print("\n" + "=" * 60)
    print("  NEXT STEPS")
    print("=" * 60)
    if not collection_exists:
        print("  1. Wait for Phase 1 to finish (check JSONL files above)")
        print("  2. Run: python scripts/ncert_smart_pipeline.py --phase2-only")
        print("     (this embeds + pushes all JSONL to Qdrant)")
    else:
        pending = [f for f in JSONL_DIR.glob("*.jsonl")] if JSONL_DIR.exists() else []
        if pending:
            print("  Some JSONL files not yet ingested. Run:")
            print("  python scripts/ncert_smart_pipeline.py --phase2-only")
        else:
            print("  All done! Knowledge base is fully loaded.")
    print()


if __name__ == "__main__":
    main()
