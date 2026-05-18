@echo off
echo Starting Aivorah Layout Detection Service (Python ML)...
echo Port: 5050 | Model: DocLayout-YOLO
echo.
cd /d "%~dp0server\python"
python layout_service.py
pause
