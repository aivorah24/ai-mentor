---
name: Port Management on Windows
description: How to handle port conflicts when running Node servers in Claude Code on Windows
type: feedback
---

Never use `kill -9 <pid>` from Git Bash to kill Windows node processes — it doesn't work (kills bash PID namespace, not Windows PID).
PowerShell Stop-Process also fails for background task processes.

**Why:** Background tasks started via Claude Code run as Windows processes that can't be addressed by Git Bash PIDs.

**How to apply:** When a port is in use, always increment to the next free port (check with `netstat -ano | grep ":PORT"`). Update all 10 frontend SERVER_URL files using a bash loop with sed. Never waste time trying to kill the old process.
