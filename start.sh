#!/bin/bash
# Start both the Python ML layout service and the Node.js server.
# The Python service runs in the background on port 5050.
# Node.js runs in the foreground on port 8080 (Cloud Run health checks go here).

echo "[start] Launching Python ML layout service on port ${LAYOUT_PORT:-5050}..."
python3 /app/server/python/layout_service.py &
PY_PID=$!

# Give Python a moment to start binding
sleep 1

echo "[start] Launching Node.js server on port ${PORT:-8080}..."
cd /app/server
exec node --max-old-space-size=3072 index.js
