import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class RunStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT)")
            # A killed development server must not leave runs polling forever.
            rows = db.execute("SELECT id, payload FROM runs").fetchall()
            for row in rows:
                run = json.loads(row[1])
                if run["status"] in ("queued", "running"):
                    run["status"] = "interrupted"
                    db.execute("UPDATE runs SET payload = ? WHERE id = ?", (json.dumps(run), row[0]))

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path)
        try:
            with db:
                yield db
        finally:
            db.close()

    def save(self, run: dict):
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO runs VALUES (?, ?, ?)",
                       (run["id"], run["created_at"], json.dumps(run, ensure_ascii=False)))

    def get(self, run_id: str) -> dict | None:
        with self.connection() as db:
            row = db.execute("SELECT payload FROM runs WHERE id = ?", (run_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self) -> list[dict]:
        with self.connection() as db:
            rows = db.execute("SELECT payload FROM runs ORDER BY created_at DESC LIMIT 50").fetchall()
        return [json.loads(row[0]) for row in rows]
