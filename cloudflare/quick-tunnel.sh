#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Zip Packers - Cloudflare QUICK tunnel (macOS / Linux)
#
#  Starts the Zip Packers server, then opens a free Cloudflare quick tunnel
#  that gives you a temporary public https://....trycloudflare.com URL.
#
#  The URL is RANDOM and changes every run. For a stable address on your own
#  domain, use a named tunnel instead (see cloudflare/README.md).
#
#  Requires cloudflared on PATH:
#      macOS:  brew install cloudflared
#      Linux:  see https://pkg.cloudflare.com/ (apt/yum) or download the binary
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-4000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo
  echo "cloudflared is not installed or not on PATH."
  echo "  macOS:  brew install cloudflared"
  echo "  Linux:  https://pkg.cloudflare.com/"
  echo
  exit 1
fi

echo "Starting Zip Packers on port $PORT ..."
echo "(start.sh pulls the latest code from GitHub first, then runs the server)"
bash start.sh &
SERVER_PID=$!
# Stop the server when this script exits (Ctrl+C on the tunnel).
trap 'echo; echo "Stopping server..."; kill "$SERVER_PID" 2>/dev/null || true' EXIT

sleep 8

echo
echo "Opening Cloudflare quick tunnel. Your public URL is printed below as"
echo "   https://something.trycloudflare.com"
echo "Share that link. Press Ctrl+C to close the tunnel and stop the server."
echo
cloudflared tunnel --url "http://localhost:$PORT"
