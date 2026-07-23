@echo off
REM Auto-resumable ICSE + Cambridge ingestion. Safe to run repeatedly:
REM already-completed (curriculum|grade|subject) scopes are skipped.
cd /d "%~dp0.."
node scripts\ingest-icse-cambridge-all.js >> scripts\ingest-icse-cambridge.log 2>&1
