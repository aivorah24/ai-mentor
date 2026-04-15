@echo off
setlocal

cd /d C:\Users\Asus\Desktop\Aivorah\server
set PORT=3006

echo Starting Aivorah backend on http://localhost:%PORT%
echo Keep this window open while using Admin Panel.
echo.

node index.js

echo.
echo Backend stopped. Press any key to close.
pause >nul
