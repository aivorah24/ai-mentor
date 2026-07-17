# Automated Teacher → Student → Parent lifecycle E2E

Headless, agent-style E2E that drives the **real pipeline** against a local stack
using 3 linked accounts. No approvals needed — it exits `0` (pass) or `1` (fail),
and saves screenshots/video/trace on failure.

## What it checks
- worksheet upload → interactive quiz generation
- **image cropping**: every image is a self-contained `data:` URI (survives disk recycle)
- **no empty task cards** (the "Task 4 = just a heading" bug)
- **edit-answers** persists into the published quiz
- **TSRA + IB PYP logos** injected into the published HTML
- **validation gate BLOCKS** an empty/broken quiz (negative test)
- **student answers correctly + submits**
- the **submission shows up** for the teacher
- **multiple-worksheet upload**
- teacher + student **log in through the real UI**

## One-time setup
```bash
# 1. seed the 3 linked accounts (teacher↔student, parent↔student) — idempotent
cd server && npm run seed:e2e
#    (remove them later with: npm run seed:e2e:clean)
```

## Run it
```bash
# start the backend (API :3006 + Python ML :5050)
cd server && node index.js

# (only for the UI-login smoke) start the web app on :8081
cd AIMentorApp && npm run web

# run the suite
cd AIMentorApp && npm run test:e2e:lifecycle
```

Env overrides: `E2E_API` (default `http://localhost:3006`), `PW_BASE_URL`
(default `http://localhost:8081`), `E2E_PASSWORD`.

## Run it automatically (no human in the loop)
- **On every push (CI):** add `npm run test:e2e:lifecycle` as a GitHub Actions job
  (start the server + expo web first, or point `E2E_API`/`PW_BASE_URL` at a running env).
- **On a schedule:** wrap the two commands in a cron/routine.

## Notes / knobs
- Real Gemini generation is slow (~1–3 min/worksheet). Timeouts are set to 3 min.
- To add multi-upload coverage, add a 2nd path to `WORKSHEETS` in the spec.
- The core assertions are API-driven (reliable). The UI-login smoke needs the
  Expo web server up; it fails fast if the app isn't reachable.
- First real run may need minor selector tuning for the pure-UI steps — the
  API steps are exact.
