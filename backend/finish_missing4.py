"""
Waits for Phase 1 (missing 4 books) to finish, then auto-runs Phase 2 for them.
Detects completion by watching for the 4 new JSONL files to appear.
"""
import subprocess
import sys
import time
import logging
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
LOGGER = logging.getLogger("finish_missing4")

JSONL_DIR = Path(__file__).parent.parent / "server" / "data" / "ncert_jsonl"
BACKEND_DIR = Path(__file__).parent

EXPECTED_JSONLS = [
    "ncert_g11_biology_kebo1.jsonl",
    "ncert_g11_english_kesp1.jsonl",
    "ncert_g12_biology_lebo1.jsonl",
    "ncert_g12_english_lefl1.jsonl",
]


def all_jsonls_ready():
    missing = [f for f in EXPECTED_JSONLS if not (JSONL_DIR / f).exists()]
    if missing:
        LOGGER.info("Waiting for: %s", ", ".join(missing))
        return False
    return True


def run_phase2():
    LOGGER.info("All 4 JSONLs ready — starting Phase 2...")
    result = subprocess.run(
        [sys.executable, "scripts/ncert_smart_pipeline.py", "--phase2-only",
         "--grades", "11", "12", "--subjects", "Biology", "English"],
        cwd=BACKEND_DIR,
    )
    if result.returncode == 0:
        LOGGER.info("Phase 2 complete! All 4 missing books now in Qdrant.")
    else:
        LOGGER.error("Phase 2 failed with exit code %d — re-running full phase2...", result.returncode)
        subprocess.run(
            [sys.executable, "scripts/ncert_smart_pipeline.py", "--phase2-only"],
            cwd=BACKEND_DIR,
        )


if __name__ == "__main__":
    LOGGER.info("Watching for 4 JSONLs: %s", EXPECTED_JSONLS)

    if all_jsonls_ready():
        LOGGER.info("JSONLs already present — running Phase 2 immediately.")
        run_phase2()
        sys.exit(0)

    while True:
        time.sleep(30)
        if all_jsonls_ready():
            run_phase2()
            break

    LOGGER.info("Done!")
