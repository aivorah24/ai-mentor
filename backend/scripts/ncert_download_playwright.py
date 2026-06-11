"""
Downloads NCERT textbook chapter PDFs using Playwright (real browser).
NCERT blocks automated HTTP requests but serves PDFs fine in a real browser.

Run:
    python scripts/ncert_download_playwright.py --grades 6 7 8 9 10 11 12
    python scripts/ncert_download_playwright.py --grades 6 --subjects Mathematics
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from playwright.async_api import async_playwright

sys.path.append(str(Path(__file__).resolve().parents[1]))

LOGGER = logging.getLogger("ncert_download_playwright")

BASE_DIR = Path(__file__).resolve().parents[2]
DOWNLOAD_DIR = BASE_DIR / "server" / "data" / "ncert_books"
NCERT_PDF_BASE = "https://ncert.nic.in/textbook/pdf"

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
    (9,  "Social Science",   "iess1", 7),   # only 7 chapters in part 1
    (9,  "English",          "iebe1", 8),

    (10, "Mathematics",      "jemh1", 15),
    (10, "Science",          "jesc1", 15),
    (10, "Social Science",   "jess1", 7),   # split across jess1/jess2/jess3
    (10, "Social Science",   "jess2", 5),
    (10, "Social Science",   "jess3", 5),
    (10, "English",          "jeff1", 9),

    (11, "Mathematics",      "kemh1", 16),
    (11, "Physics",          "keph1", 7),   # part 1 only (7 ch)
    (11, "Physics",          "keph2", 7),   # part 2
    (11, "Chemistry",        "kech1", 6),   # part 1 only (6 ch)
    (11, "Chemistry",        "kech2", 3),   # part 2
    (11, "Biology",          "kebo1", 19),
    (11, "Biology",          "kebs1", 11),  # supplementary
    (11, "Economics",        "keec1", 8),
    (11, "English",          "kesp1", 5),
    (11, "History",          "kehs1", 7),   # Themes in World History
    (11, "Political Science","keps1", 11),
    (11, "Accountancy",      "keac1", 9),
    (11, "Accountancy",      "keac2", 5),
    (11, "Business Studies", "kebs1", 11),
    (11, "Computer Science", "kecs1", 7),

    (12, "Mathematics",      "lemh1", 6),   # part 1
    (12, "Mathematics",      "lemh2", 7),   # part 2
    (12, "Physics",          "leph1", 8),   # part 1
    (12, "Physics",          "leph2", 6),   # part 2
    (12, "Chemistry",        "lech1", 5),   # part 1
    (12, "Chemistry",        "lech2", 5),   # part 2
    (12, "Biology",          "lebo1", 13),
    (12, "Biology",          "lebs1", 8),   # supplementary
    (12, "Economics",        "leec1", 6),
    (12, "English",          "lefl1", 13),
    (12, "History",          "lehh1", 8),
    (12, "History",          "lehh2", 7),
    (12, "History",          "lehh3", 5),
    (12, "Political Science","leps1", 9),
    (12, "Political Science","leps2", 9),
    (12, "Accountancy",      "leac1", 9),
    (12, "Accountancy",      "leac2", 4),
    (12, "Business Studies", "lebs1", 6),
    (12, "Business Studies", "lebs2", 6),
    (12, "Computer Science", "lecs1", 9),
]


async def download_book(page, grade: int, subject: str, book_code: str, num_chapters: int) -> list[Path]:
    book_dir = DOWNLOAD_DIR / f"grade{grade}" / subject.lower().replace(" ", "_")
    book_dir.mkdir(parents=True, exist_ok=True)
    downloaded = []

    for ch in range(1, num_chapters + 1):
        dest = book_dir / f"{book_code}{ch:02d}.pdf"
        if dest.exists() and dest.stat().st_size > 2048:
            LOGGER.info("    Already exists: %s", dest.name)
            downloaded.append(dest)
            continue

        pdf_filename = f"{book_code}{ch:02d}.pdf"
        pdf_url = f"{NCERT_PDF_BASE}/{pdf_filename}"
        referer_url = f"https://ncert.nic.in/textbook.php?{book_code}={ch}-{num_chapters}"
        try:
            # Visit textbook page to establish referer/cookies, then capture PDF response
            await page.goto(referer_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(0.3)

            # Intercept the PDF response via route
            pdf_body: list[bytes] = []

            async def handle_route(route):
                response = await route.fetch()
                pdf_body.append(await response.body())
                await route.fulfill(response=response)

            await page.route(f"**/{pdf_filename}", handle_route)
            try:
                await page.goto(pdf_url, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                pass  # PDF render in browser may throw navigation error — body is captured
            await page.unroute(f"**/{pdf_filename}")

            if pdf_body and len(pdf_body[0]) > 2048 and pdf_body[0][:4] == b"%PDF":
                dest.write_bytes(pdf_body[0])
                LOGGER.info("    Downloaded %s (%d KB)", dest.name, len(pdf_body[0]) // 1024)
                downloaded.append(dest)
            else:
                size = len(pdf_body[0]) if pdf_body else 0
                LOGGER.debug("    Not a valid PDF (%d B): %s", size, pdf_filename)
        except Exception as exc:
            LOGGER.debug("    Error %s: %s", pdf_url, exc)
        await asyncio.sleep(0.5)

    LOGGER.info("  Grade %d %s (%s): %d/%d chapters downloaded", grade, subject, book_code, len(downloaded), num_chapters)
    return downloaded


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    parser = argparse.ArgumentParser(description="Download NCERT PDFs using Playwright.")
    parser.add_argument("--grades", type=int, nargs="+", default=list(range(6, 13)))
    parser.add_argument("--subjects", nargs="+")
    args = parser.parse_args()

    grade_set = set(args.grades)
    subject_filter = {s.lower() for s in args.subjects} if args.subjects else None

    books = [
        b for b in NCERT_BOOKS
        if b[0] in grade_set and (subject_filter is None or b[1].lower() in subject_filter)
    ]

    LOGGER.info("Downloading %d books...", len(books))
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    total_downloaded = 0

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            accept_downloads=True,
        )
        page = await context.new_page()

        # Visit NCERT homepage first to establish session
        LOGGER.info("Establishing NCERT session...")
        await page.goto("https://ncert.nic.in/textbook.php", wait_until="domcontentloaded", timeout=30000)

        for grade, subject, book_code, num_chapters in books:
            LOGGER.info("=== Grade %d | %s | %s ===", grade, subject, book_code)
            pdfs = await download_book(page, grade, subject, book_code, num_chapters)
            total_downloaded += len(pdfs)

        await browser.close()

    LOGGER.info("=== DONE: %d PDFs downloaded to %s ===", total_downloaded, DOWNLOAD_DIR)
    LOGGER.info("Next: run the smart pipeline to ingest them:")
    LOGGER.info("  python scripts/ncert_smart_pipeline.py --phase2-only")
    LOGGER.info("  (or) python scripts/ncert_smart_pipeline.py  [downloads + ingests]")


if __name__ == "__main__":
    asyncio.run(main())
