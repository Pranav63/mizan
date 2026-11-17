"""Loopback-only bridge to the installed SemIf MLX scorer; run with its venv."""
import json
import platform
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from semif_phase1 import core, mlx_backend

MODEL = "Qwen/Qwen3.5-4B"
REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"


def serve():
    print("SemIf: loading cached Qwen3.5-4B on MLX…", flush=True)
    model, tokenizer, metadata = mlx_backend.load_model(MODEL, REVISION)
    source_root = Path(core.__file__).resolve().parents[2]
    metadata["semif_commit"] = subprocess.check_output(
        ["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True).strip()
    metadata["hardware"] = {
        "chip": subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip(),
        "memory_bytes": int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True)),
        "os": platform.mac_ver()[0], "architecture": platform.machine(),
    }
    # Warm the resident model before accepting requests; warm-up is not scored.
    mlx_backend.score(model, tokenizer, {
        "id": "warmup", "state": "An expense policy.", "question": "What is the topic?",
        "options": [{"id": "expenses", "description": "Expenses"},
                    {"id": "travel", "description": "Travel"}],
    }, metadata)

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, payload):
            encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, {"status": "ready", "model": metadata})
            else:
                self.reply(404, {"error": "Not found"})

        def do_POST(self):
            if self.path != "/score":
                self.reply(404, {"error": "Not found"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 65536:
                    self.reply(413, {"error": "Request exceeds the local scorer limit"})
                    return
                row = json.loads(self.rfile.read(size))
                core.validate_row(row)
                result = mlx_backend.score(model, tokenizer, row, metadata)
            except (ValueError, TypeError, KeyError, AttributeError):
                self.reply(422, {"error": "Invalid decision input or token limit exceeded"})
                return
            except Exception:
                self.reply(503, {"error": "Local inference failed"})
                return
            self.reply(200, result)

        def log_message(self, *_):
            pass  # Never log policy contents.

    print("SemIf: ready at http://127.0.0.1:8019 · MLX BF16 · direct option logits", flush=True)
    # One resident context, one request at a time; no shared-state cache.
    server = HTTPServer(("127.0.0.1", 8019), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    serve()
