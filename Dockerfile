# ─── Production Server ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# NOTE: puppeteer IS used by a live server route (quiz.js docx→PDF conversion
# for Word-worksheet uploads), not just local scripts — do NOT set
# PUPPETEER_SKIP_DOWNLOAD here. Skipping it left Chrome missing in production,
# so every .docx upload failed with "Could not find Chrome" at runtime.
ENV NODE_ENV=production
ENV PORT=8080

# ── Python 3 + the ML layout/crop microservice's deps, PLUS the shared
# libraries headless Chrome needs to actually launch (node:20-slim is a
# minimal Debian image with none of these) ──
# Without the python libs, server/python/layout_service.py has nowhere to run
# in production, so every image-crop/table-detect call silently falls back to
# the crude "whole page" fallback. Without the Chrome libs, puppeteer.launch()
# in quiz.js's docx→PDF conversion fails at runtime even after Chrome itself
# downloads successfully ("error while loading shared libraries").
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-dev build-essential \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libxcb1 \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libx11-6 libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libxshmfence1 xdg-utils wget \
    && rm -rf /var/lib/apt/lists/*
COPY server/python/requirements.txt ./server/python/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r server/python/requirements.txt

# ── Install Node.js server dependencies ──
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server code
COPY server/ ./server/

# ── Pre-download the DocLayout-YOLO model at build time ──
# server/python/models/ is gitignored (39MB, not committed), so without this the
# service falls back to downloading it lazily on the first live request — which
# was crashing (HF_TOKEN env var has a stray BOM character huggingface_hub can't
# ascii-encode into a request header). Downloading here, before Node's runtime
# env vars (incl. HF_TOKEN) are even set, sidesteps that entirely and means the
# very first crop request in production doesn't have to wait on a cold download.
RUN python3 -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='juliozhao/DocLayout-YOLO-DocStructBench', filename='doclayout_yolo_docstructbench_imgsz1024.pt', cache_dir='/app/server/python/models')"

# Copy pre-built frontend (built locally via: npx expo export --platform web --output-dir dist2)
# server/index.js serves from path.join(__dirname, '../AIMentorApp/dist2')
COPY AIMentorApp/dist2/_expo        ./AIMentorApp/dist2/_expo
COPY AIMentorApp/dist2/index.html   ./AIMentorApp/dist2/index.html
COPY AIMentorApp/dist2/favicon.ico  ./AIMentorApp/dist2/favicon.ico
COPY AIMentorApp/dist2/metadata.json ./AIMentorApp/dist2/metadata.json
# Copy font assets explicitly — avoids .dockerignore node_modules exclusion
COPY AIMentorApp/dist2/assets       ./AIMentorApp/dist2/assets
# Vosk on-device speech model for Read Aloud — served at /models/... so the
# in-browser "Read Along" engine works in production too. Sourced from the
# committed AIMentorApp/public/models (small, stable — not the rebuilt dist2/models).
COPY AIMentorApp/public/models      ./AIMentorApp/dist2/models

# ── Copy startup script ──
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8080

# start.sh launches the Python layout service in the background, then Node in
# the foreground (Cloud Run health checks hit Node's port). Node's default
# LAYOUT_SERVICE_URL of http://localhost:5050 reaches it since both processes
# share this one container.
WORKDIR /app
CMD ["/app/start.sh"]
