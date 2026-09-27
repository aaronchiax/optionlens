@echo off
REM Starts OptionLens (Python market-data service + Next.js) without relying on a refreshed PATH.
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
where npm >nul 2>nul || (echo Node.js not found. Install it from https://nodejs.org & pause & exit /b 1)
echo Starting OptionLens... open http://localhost:3000 once you see "Ready".
call npm run dev
