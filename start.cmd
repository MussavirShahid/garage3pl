@echo off
REM ---------------------------------------------------------------------------
REM  Zip Packers - start (Windows)
REM
REM  Pulls the latest code from GitHub, installs anything new, then runs the
REM  server. Double-click this, or run it from any terminal. Using it means
REM  every launch is on the newest version without a separate "git pull".
REM
REM  Runs in cmd, so it is not affected by PowerShell's script policy.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if exist ".git" (
  where git >nul 2>nul
  if errorlevel 1 (
    echo git is not installed, so updates cannot be pulled. Install it once with:
    echo     winget install --id Git.Git --exact
    echo Starting with the code already here.
  ) else (
    echo Pulling the latest code from GitHub...
    git pull --ff-only
    if errorlevel 1 echo Could not pull ^(offline, or local edits in the way^). Starting with the code already here.
  )
) else (
  echo This folder is not a git clone ^(probably a ZIP download^), so it cannot receive updates.
  echo To get automatic updates, clone it once instead of downloading the ZIP:
  echo     git clone https://github.com/MussavirShahid/garage3pl.git
  echo Starting with the code already here.
)

if "%PORT%"=="" set PORT=4000
echo.
echo Installing/refreshing dependencies...
call npm.cmd install --no-audit --no-fund
echo.
node src\server.js
endlocal
