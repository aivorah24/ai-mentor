# ─── Production Server ────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Skip Chromium download — puppeteer only used in local scripts, not server routes
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production
ENV PORT=8080

# ── Python 3 + the ML layout/crop microservice's deps ──
# Without this, server/python/layout_service.py has nowhere to run in production,
# so every image-crop/table-detect call silently fails over to the crude
# "whole page" fallback (worksheet images render uncropped/misplaced in prod).
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-dev build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY server/python/requirements.txt ./server/python/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r server/python/requirements.txt

# ── Install Node.js server dependencies ──
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server code
COPY server/ ./server/

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
