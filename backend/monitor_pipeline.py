import subprocess, time, sys, os
from pathlib import Path

BACKEND = Path("C:/Users/Asus/Downloads/Aivorah/Aivorah/backend")
JSONL_DIR = Path("C:/Users/Asus/Downloads/Aivorah/Aivorah/server/data/ncert_jsonl")
LOG = open(BACKEND / "monitor.log", "w", buffering=1)

EXPECTED_G8_12 = [
    "ncert_g8_mathematics_hegp1", "ncert_g8_mathematics_hegp2",
    "ncert_g8_science_hecu1", "ncert_g8_social_science_hees1", "ncert_g8_english_hepr1",
    "ncert_g9_mathematics_iemh1", "ncert_g9_science_iesc1",
    "ncert_g9_social_science_iess1", "ncert_g9_english_iebe1",
    "ncert_g10_mathematics_jemh1", "ncert_g10_science_jesc1",
    "ncert_g10_social_science_jess1",
    "ncert_g11_mathematics_kemh1", "ncert_g11_physics_keph1",
    "ncert_g11_chemistry_kech1", "ncert_g11_biology_kebo1",
    "ncert_g11_economics_keec1", "ncert_g11_english_kesp1",
    "ncert_g12_mathematics_lemh1", "ncert_g12_physics_leph1",
    "ncert_g12_chemistry_lech1", "ncert_g12_biology_lebo1",
    "ncert_g12_economics_leec1", "ncert_g12_english_lefl1",
]

def is_python_running():
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq python.exe", "/FO", "CSV"],
                       capture_output=True, text=True)
    return "python.exe" in r.stdout

def phase1_complete():
    existing = [f.stem for f in JSONL_DIR.glob("*.jsonl")]
    missing = [e for e in EXPECTED_G8_12 if e not in existing]
    return len(missing) == 0, missing

def restart_phase1():
    LOG.write("RESTARTING Phase 1...\n")
    subprocess.Popen([sys.executable, "scripts/ncert_smart_pipeline.py",
                      "--phase1-only", "--grades", "8", "9", "10", "11", "12"],
                     cwd=str(BACKEND), stdout=LOG, stderr=LOG)

def restart_phase2():
    LOG.write("RESTARTING Phase 2...\n")
    subprocess.Popen([sys.executable, "scripts/ncert_smart_pipeline.py", "--phase2-only"],
                     cwd=str(BACKEND), stdout=LOG, stderr=LOG)

LOG.write("Monitor started.\n")
while True:
    time.sleep(900)  # 15 mins
    running = is_python_running()
    p1_done, missing = phase1_complete()
    p2_log = (BACKEND / "phase2_autostart.log").read_text() if (BACKEND / "phase2_autostart.log").exists() else ""
    p2_done = "Phase 2 finished with exit code 0" in p2_log
    p2_error = "exit code 1" in p2_log or ("Phase 2 finished" in p2_log and "exit code 0" not in p2_log)

    LOG.write(f"\n[CHECK] python_running={running} p1_done={p1_done} p2_done={p2_done}\n")

    if p2_done:
        LOG.write("ALL DONE! Phase 1 + Phase 2 complete.\n")
        break
    elif not running and not p1_done:
        LOG.write(f"Phase 1 crashed! Missing: {missing}\n")
        restart_phase1()
    elif not running and p1_done and p2_error:
        LOG.write("Phase 2 crashed!\n")
        restart_phase2()
    elif running:
        LOG.write(f"Phase 1 running. JSONLs done: {len([e for e in EXPECTED_G8_12 if e in [f.stem for f in JSONL_DIR.glob('*.jsonl')]])}/{len(EXPECTED_G8_12)}\n")
