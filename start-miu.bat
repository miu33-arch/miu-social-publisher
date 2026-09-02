@echo off
title MIU SOVEREIGN AEC SUITE // LAUNCHER
echo ====================================================
echo  STARTING MIU AEC SOVEREIGN CORE & STUDIO FRONTEND
echo ====================================================

:: 1. Launch Express / Node Backend
start "MIU Backend Core (Port 5000)" cmd /k "cd /d C:\miu_studio\miu-social-publisher && node server.js"

:: 2. Launch Next.js Studio Frontend
start "MIU Studio Frontend (Port 3000)" cmd /k "cd /d C:\miu_studio\studio-frontend && npm run dev"

echo.
echo Both services launched in separate windows.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:5000
echo.
pause