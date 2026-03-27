#!/bin/bash
# Table2Knowledge Studio – Setup Script (macOS / Linux)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║      Table2Knowledge Studio Setup      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── Python Check ──────────────────────────────────────────────────────────────
echo "▶ Checking Python..."
if ! command -v python3 &>/dev/null; then
  echo "  ✗ python3 not found. Please install Python 3.10+"
  exit 1
fi
PYTHON=$(command -v python3)
echo "  ✓ $($PYTHON --version)"

# ── Virtual Environment ──────────────────────────────────────────────────────
echo "▶ Setting up Python virtual environment..."
if [ ! -d "backend/.venv" ]; then
  $PYTHON -m venv backend/.venv
  echo "  ✓ .venv created"
else
  echo "  ✓ .venv already exists"
fi

source backend/.venv/bin/activate

echo "▶ Installing Python dependencies..."
pip install -q -r backend/requirements.txt
echo "  ✓ Done"

# ── Node Check ───────────────────────────────────────────────────────────────
echo "▶ Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "  ✗ node not found. Please install Node.js 18+"
  exit 1
fi
echo "  ✓ Node $(node --version)"

# ── Frontend Dependencies ────────────────────────────────────────────────────
echo "▶ Installing frontend dependencies..."
cd frontend
if [ ! -d "node_modules" ]; then
  npm install --silent
  echo "  ✓ node_modules installed"
else
  echo "  ✓ node_modules already exists"
fi
cd ..

echo ""
echo "════════════════════════════════════════"
echo "  ✓ Setup complete!"
echo "  Run ./start.sh to launch the app."
echo "════════════════════════════════════════"
echo ""
