@echo off
REM ---------------------------------------------------------------------------
REM  Zip Packers - Cloudflare QUICK tunnel (Windows)
REM
REM  Starts the Zip Packers server, then opens a free Cloudflare quick tunnel
REM  that gives you a temporary public https://....trycloudflare.com URL.
REM
REM  The URL is RANDOM and changes every time you run this. Good for a quick
REM  "show someone from anywhere" session. For a stable address on your own
REM  domain, use a named tunnel instead (see cloudflare/README.md).
REM
REM  Requires cloudflared installed and on PATH:
REM      winget install --id Cloudflare.cloudflared
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0\.."

if "%PORT%"=="" set PORT=4000

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo cloudflared is not installed or not on PATH.
  echo Install it with:  winget install --id Cloudflare.cloudflared
  echo Then run this file again.
  echo.
  pause
  exit /b 1
)

echo Starting Zip Packers on port %PORT% in a new window...
start "Zip Packers server" cmd /k "cd /d "%~dp0\.." && node src\server.js"

echo Waiting for the server to come up...
timeout /t 3 >nul

echo.
echo Opening Cloudflare quick tunnel. Your public URL is printed below as
echo    https://something.trycloudflare.com
echo Share that link. Press Ctrl+C here to close the tunnel.
echo (Closing the tunnel does NOT stop the server window - close that too.)
echo.
cloudflared tunnel --url http://localhost:%PORT%

endlocal
