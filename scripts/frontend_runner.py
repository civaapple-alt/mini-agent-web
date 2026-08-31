"""
Helper script to launch the React 19 + Vite frontend development server on port 5173.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def run_frontend_dev() -> None:
    """Launch Vite frontend dev server (port 5173)."""
    frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
    if not frontend_dir.exists():
        print(f"❌ Error: frontend directory not found at {frontend_dir}")
        sys.exit(1)

    node_modules = frontend_dir / "node_modules"
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"

    # Auto install dependencies if node_modules doesn't exist
    if not node_modules.exists():
        print("📦 Installing frontend dependencies with npm...")
        subprocess.run([npm_cmd, "install"], cwd=str(frontend_dir), check=True)

    print("🚀 Starting Vite React Frontend on http://localhost:5173...")
    print(
        "📡 Proxying /api and /ws requests to FastAPI backend on http://localhost:8000"
    )
    try:
        subprocess.run([npm_cmd, "run", "dev"], cwd=str(frontend_dir), check=True)
    except KeyboardInterrupt:
        print("\n👋 Frontend dev server stopped.")


if __name__ == "__main__":
    run_frontend_dev()
