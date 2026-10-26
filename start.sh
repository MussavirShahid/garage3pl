#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Zip Packers - start (macOS / Linux)
#
#  Pulls the latest code from GitHub, installs anything new, then runs the
#  server. Using it means every launch is on the newest version without a
#  separate "git pull".
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")"

if [ -d .git ]; then
  if command -v git >/dev/null 2>&1; then
    echo "Pulling the latest code from GitHub..."
    git pull --ff-only || echo "Could not pull (offline, or local edits in the way). Starting with the code already here."
  else
    echo "git is not installed, so updates cannot be pulled. Starting with the code already here."
  fi
else
  echo "This folder is not a git clone (probably a ZIP download), so it cannot receive updates."
  echo "To get automatic updates, clone it once: git clone https://github.com/MussavirShahid/garage3pl.git"
fi

export PORT="${PORT:-4000}"
echo
echo "Installing/refreshing dependencies..."
npm install --no-audit --no-fund
echo
exec node src/server.js
