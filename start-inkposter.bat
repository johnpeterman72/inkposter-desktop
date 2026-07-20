@echo off
title InkPoster Desktop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on your PATH.
  echo Install Node.js from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "server\config.local.json" (
  echo ERROR: server\config.local.json is missing.
  echo Copy server\config.local.example.json to server\config.local.json and add
  echo your InkPoster email + password ^(the server logs in automatically^).
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   InkPoster Desktop
echo   Opening http://localhost:4173
echo   Close this window or press Ctrl+C to stop.
echo ============================================
echo.

rem Open the browser ~2 seconds after the server starts
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:4173"

node server\index.js

echo.
echo Server stopped.
pause
