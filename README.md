# ai-mentor (legacy monolith)

The original Aivorah backend and app. Most features have moved to dedicated `aivorah-*-service` repos and the new `aivorah-frontend`. This repo is **legacy**: keep it running, fix only what's needed, and never add new dependencies on it. Check the service map in `aivorah24/aivorah-handover` before assuming a feature lives here.

## Parts
| Path | What it is |
|---|---|
| `server/` | Node/Express API (`npm start` from `server/`). Routes in `server/routes/`, business logic in `server/services/` |
| `backend/` | Python RAG service (Qdrant). See `backend/README.md` and `backend/.env.example` |
| `AIMentorApp/` | Old Expo app, replaced by `aivorah-frontend` |
| `pipeline/`, `server/pipelines/`, `scripts/` | Content ingestion and curriculum seeding scripts |
| `Dockerfile`, `cloudbuild.yaml`, `deploy.cjs`, `vercel.json` | Old deploy configs |

## Run the server
```bash
cd server
npm ci
npm start        # needs server/.env (Supabase, Qdrant, AI provider keys)
```
