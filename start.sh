#!/bin/bash
# Table2Knowledge Studio – Start Script (macOS / Linux)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║       Table2Knowledge Studio           ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── Pre-flight Checks ────────────────────────────────────────────────────────
if [ ! -d "backend/.venv" ]; then
  echo "  ✗ Virtual environment not found!"
  echo "    Please run ./setup.sh first."
  exit 1
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "  ✗ Frontend dependencies not found!"
  echo "    Please run ./setup.sh first."
  exit 1
fi

source backend/.venv/bin/activate

# ── Launch ────────────────────────────────────────────────────────────────────
echo "▶ Starting backend  →  http://localhost:8000"
cd backend
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

sleep 1

echo "▶ Starting frontend →  http://localhost:3000"
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "════════════════════════════════════════"
echo "  App:     http://localhost:3000"
echo "  API:     http://localhost:8000/docs"
echo "  Stop:    Ctrl+C"
echo "════════════════════════════════════════"
echo ""

# Wait and cleanup on Ctrl+C
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; deactivate 2>/dev/null; exit 0" INT TERM
wait
