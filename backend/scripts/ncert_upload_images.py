"""
NCERT Image Extract + Cloudinary Upload
----------------------------------------
For each chapter PDF (G6-G12):
  1. Extract images using PyMuPDF
  2. Upload each image to Cloudinary
  3. Save a JSON index: { grade, subject, chapter, page, cloudinary_url, public_id }

Run:
    python scripts/ncert_upload_images.py
    python scripts/ncert_upload_images.py --grades 6 7
    python scripts/ncert_upload_images.py --dry-run   # count images, no upload

Output:
    server/data/ncert_image_jsonl/ncert_images_index.json
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import cloudinary
import cloudinary.uploader
import fitz  # PyMuPDF

# ── Config ──────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).resolve().parents[2]
BOOKS_DIR   = BASE_DIR / "server" / "data" / "ncert_books"
OUTPUT_DIR  = BASE_DIR / "server" / "data" / "ncert_image_jsonl"
INDEX_FILE  = OUTPUT_DIR / "ncert_images_index.json"
CHECKPOINT  = OUTPUT_DIR / "upload_checkpoint.json"

MIN_SIZE  = 5_000   # bytes  — skip tiny icons/decorations
MIN_DIM   = 80      # pixels — skip tiny images
MAX_RATIO = 6       # skip banners wider than 6:1
MAX_DIM   = 2000    # pixels — skip full-page background images
MIN_AREA  = 10_000  # pixel area — skip very small decorative images

cloudinary.config(
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "di5iq2mmb"),
    api_key    = os.getenv("CLOUDINARY_API_KEY",    "***REMOVED***"),
    api_secret = os.getenv("CLOUDINARY_API_SECRET", "***REMOVED***"),
)

# ── Grade → subject → PDF prefix mapping ────────────────────────────────────
# Each entry: (grade, subject, book_prefix, num_chapters)
NCERT_BOOKS = [
    (6,  "Mathematics",    "fegp1",  10),
    (6,  "Science",        "fecu1",  12),
    (6,  "Social_Science", "fees1",  14),
    (6,  "English",        "fepr1",   5),
    (7,  "Mathematics",    "gegp1",   8),
    (7,  "Mathematics",    "gegp2",   7),
    (7,  "Science",        "gecu1",  12),
    (7,  "Social_Science", "gees1",  12),
    (7,  "Social_Science", "gees2",   8),
    (7,  "English",        "gepr1",   5),
    (8,  "Mathematics",    "hegp1",   7),
    (8,  "Mathematics",    "hegp2",   7),
    (8,  "Science",        "hecu1",  13),
    (8,  "Social_Science", "hees1",   7),
    (8,  "English",        "hepr1",   5),
    (9,  "Mathematics",    "iemh1",   8),
    (9,  "Science",        "iesc1",  13),
    (9,  "Social_Science", "iess1",  23),
    (9,  "English",        "iebe1",   8),
    (10, "Mathematics",    "jemh1",  15),
    (10, "Science",        "jesc1",  15),
    (10, "Social_Science", "jess1",  23),
    (10, "English",        "jeeb1",   8),
    (11, "Mathematics",    "kemh1",  16),
    (11, "Physics",        "keph1",  15),
    (11, "Chemistry",      "kech1",  14),
    (11, "Biology",        "kebi1",  13),
    (11, "Economics",      "keec1",  12),
    (11, "English",        "keeb1",  10),
    (12, "Mathematics",    "lemh1",  13),
    (12, "Physics",        "leph1",  15),
    (12, "Chemistry",      "lech1",  16),
    (12, "Biology",        "lebi1",  13),
    (12, "Economics",      "leec1",  14),
    (12, "English",        "leeb1",  12),
]

def is_good_image(img_data, width, height):
    if len(img_data) < MIN_SIZE:
        return False
    if width < MIN_DIM or height < MIN_DIM:
        return False
    if width > 0 and height > 0:
        ratio = max(width, height) / min(width, height)
        if ratio > MAX_RATIO:
            return False
        # Skip banner/border images: very wide and short
        if width > 5 * height:
            return False
        # Skip QR codes: near-square, very small
        if abs(width - height) < 10 and width < 150:
            return False
    # Skip full-page background images
    if width > MAX_DIM and height > MAX_DIM:
        return False
    # Skip tiny area images
    if width * height < MIN_AREA:
        return False
    return True

def extract_images(pdf_path: Path):
    """Return list of (page_num, img_index, img_bytes, ext, width, height)."""
    results = []
    try:
        doc = fitz.open(str(pdf_path))
        for page_num, page in enumerate(doc, 1):
            for img_idx, img in enumerate(page.get_images(full=True)):
                xref = img[0]
                base_img = doc.extract_image(xref)
                data   = base_img["image"]
                ext    = base_img["ext"]
                width  = base_img.get("width", 0)
                height = base_img.get("height", 0)
                if is_good_image(data, width, height):
                    results.append((page_num, img_idx, data, ext, width, height))
        doc.close()
    except Exception as e:
        print(f"  [WARN] fitz error on {pdf_path.name}: {e}")
    return results

def upload_to_cloudinary(img_bytes, public_id, ext):
    """Upload image bytes to Cloudinary, return URL."""
    result = cloudinary.uploader.upload(
        img_bytes,
        public_id   = public_id,
        folder      = "ncert_images",
        overwrite   = False,
        resource_type = "image",
        format      = ext if ext in ("jpg", "jpeg", "png", "webp") else "png",
    )
    return result["secure_url"], result["public_id"]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--grades", nargs="+", type=int, help="Grades to process (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Count images only, no upload")
    parser.add_argument("--chain-pipeline", action="store_true", help="Run ncert_image_pipeline.py after upload completes")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load checkpoint (already uploaded public_ids)
    checkpoint = set()
    if CHECKPOINT.exists():
        checkpoint = set(json.loads(CHECKPOINT.read_text()))
        print(f"Resuming — {len(checkpoint)} images already uploaded\n")

    # Load existing index
    index = []
    if INDEX_FILE.exists():
        index = json.loads(INDEX_FILE.read_text())

    grades_filter = set(args.grades) if args.grades else None
    books = [b for b in NCERT_BOOKS if grades_filter is None or b[0] in grades_filter]

    total_uploaded = 0
    total_skipped  = 0
    total_errors   = 0

    for grade, subject, prefix, num_chapters in books:
        subject_dir = BOOKS_DIR / f"grade{grade}" / subject.lower().replace(" ", "_")
        if not subject_dir.exists():
            # try alternate naming
            subject_dir = BOOKS_DIR / f"grade{grade}" / subject.lower().replace("_", " ")
        if not subject_dir.exists():
            print(f"[SKIP] No dir: grade{grade}/{subject}")
            continue

        print(f"\n=== Grade {grade} — {subject} ({prefix}) ===")

        # Find chapter PDFs: prefix + chapter number (2 digits)
        for ch in range(1, num_chapters + 1):
            pdf_name = f"{prefix}{ch:02d}.pdf"
            pdf_path = subject_dir / pdf_name
            if not pdf_path.exists():
                # try without leading zero
                pdf_path = subject_dir / f"{prefix}{ch}.pdf"
            if not pdf_path.exists():
                continue

            imgs = extract_images(pdf_path)
            print(f"  Ch{ch:02d}: {len(imgs)} images extracted from {pdf_name}")

            for page_num, img_idx, img_bytes, ext, width, height in imgs:
                public_id = f"ncert/g{grade}/{subject.lower()}/{prefix}_ch{ch:02d}_p{page_num}_i{img_idx}"

                if public_id in checkpoint:
                    total_skipped += 1
                    continue

                if args.dry_run:
                    print(f"    [DRY] {public_id} ({width}x{height})")
                    total_uploaded += 1
                    continue

                try:
                    url, pid = upload_to_cloudinary(img_bytes, public_id, ext)
                    entry = {
                        "grade":    grade,
                        "subject":  subject,
                        "chapter":  ch,
                        "page":     page_num,
                        "width":    width,
                        "height":   height,
                        "public_id": pid,
                        "url":      url,
                    }
                    index.append(entry)
                    checkpoint.add(public_id)
                    total_uploaded += 1

                    # Save checkpoint every upload
                    CHECKPOINT.write_text(json.dumps(list(checkpoint)))
                    INDEX_FILE.write_text(json.dumps(index, indent=2))
                    if total_uploaded % 20 == 0:
                        print(f"    OK {total_uploaded} uploaded so far...")

                except Exception as e:
                    print(f"    [ERR] {public_id}: {e}")
                    total_errors += 1
                    time.sleep(1)

    # Final save
    if not args.dry_run:
        CHECKPOINT.write_text(json.dumps(list(checkpoint)))
        INDEX_FILE.write_text(json.dumps(index, indent=2))

    print(f"\n{'='*50}")
    print(f"Done!")
    print(f"  Uploaded : {total_uploaded}")
    print(f"  Skipped  : {total_skipped} (already done)")
    print(f"  Errors   : {total_errors}")
    print(f"  Index    : {INDEX_FILE}")

    if args.chain_pipeline and not args.dry_run:
        pipeline_script = Path(__file__).parent / "ncert_image_pipeline.py"
        cmd = [sys.executable, str(pipeline_script)]
        if args.grades:
            cmd += ["--grades"] + [str(g) for g in args.grades]
        print(f"\n{'='*50}")
        print(f"Chaining into ncert_image_pipeline.py ...")
        print(f"Command: {' '.join(cmd)}")
        print(f"{'='*50}\n")
        subprocess.run(cmd, check=False)

if __name__ == "__main__":
    main()
