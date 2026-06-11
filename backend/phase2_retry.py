import subprocess, sys, time
from pathlib import Path

log = open(Path(__file__).parent / "phase2_retry.log", "w", buffering=1)
log.write("Phase 2 retry watcher started\n")

attempt = 0
while True:
    attempt += 1
    log.write(f"\nAttempt {attempt} at {time.strftime('%H:%M:%S')}\n")
    result = subprocess.run(
        [sys.executable, "scripts/ncert_smart_pipeline.py", "--phase2-only"],
        cwd=str(Path(__file__).parent),
        capture_output=True, text=True
    )
    log.write(result.stdout[-2000:] if result.stdout else "")
    log.write(result.stderr[-500:] if result.stderr else "")
    if result.returncode == 0:
        log.write("SUCCESS! Phase 2 complete.\n")
        break
    log.write(f"Failed (exit {result.returncode}), retrying in 2 mins...\n")
    time.sleep(120)
