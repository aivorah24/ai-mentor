@echo off
setlocal

set ADMIN_EMAIL=admin@aivorah.ai
set ADMIN_URL=http://localhost:3006/admin/panel?email=%ADMIN_EMAIL%

start "Aivorah Backend (3006)" cmd /k "cd /d C:\Users\Asus\Desktop\Aivorah\server && set PORT=3006 && node index.js"
timeout /t 3 /nobreak >nul
start "" "%ADMIN_URL%"

echo Opened: %ADMIN_URL%
echo If page does not load, check backend window for errors.
