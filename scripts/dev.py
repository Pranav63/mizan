"""Start the UI, API and configured local scorer; stop them with Ctrl+C."""
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from backend.config import Settings

def occupied(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=.5):
            return True
    except OSError:
        return False


def already_running():
    try:
        with httpx.Client(timeout=2, trust_env=False) as client:
            ui = client.get("http://127.0.0.1:5178/")
            api = client.get("http://127.0.0.1:8018/openapi.json")
            ui.raise_for_status()
            api.raise_for_status()
            return "<title>Mizan" in ui.text and api.json()["info"]["title"] == "Mizan Benchmark API"
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return False


def stop_children(children):
    # npm owns a Vite child process. Terminate the entire group, even if npm exited.
    for child in children:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for child in children:
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()


def interrupt(_signum, _frame):
    raise KeyboardInterrupt


def main():
    settings = Settings()
    ports = [5178, 8018] + ([8019] if settings.semif_python else [])
    busy = [port for port in ports if occupied(port)]
    if busy:
        if 5178 in busy and 8018 in busy and already_running():
            print("Mizan is already running: http://127.0.0.1:5178\n"
                  "Reuse this workspace. Stop it with Ctrl+C in its original terminal.", flush=True)
            return 0
        print("Cannot start Mizan: port(s) " + ", ".join(map(str, busy)) + " are already in use.\n"
              "Stop the existing server in its terminal, then run ./start.sh again.", file=sys.stderr)
        return 1

    signal.signal(signal.SIGTERM, interrupt)
    children = []
    try:
        if settings.semif_python:
            children.append(subprocess.Popen([settings.semif_python, "scripts/semif_server.py"], cwd=root,
                                              start_new_session=True))
        children.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app",
                                          "--host", "127.0.0.1", "--port", "8018"], cwd=root,
                                          start_new_session=True))
        children.append(subprocess.Popen(["npm", "run", "dev"], cwd=root / "frontend",
                                          start_new_session=True))
        print("Mizan: http://127.0.0.1:5178 · API: http://127.0.0.1:8018/docs", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(.25)
    except KeyboardInterrupt:
        pass
    finally:
        stop_children(children)
    failures = [child.returncode for child in children if child.returncode not in (0, -15, -2)]
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
