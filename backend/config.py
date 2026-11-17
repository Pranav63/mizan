import os
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
SEMIF_MODEL = "Qwen/Qwen3.5-4B"
SEMIF_REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"


class Settings:
    def __init__(self):
        self.values = {**dotenv_values(ROOT / ".env"), **os.environ}
        self.openai_model = self.values.get("OPENAI_MODEL", "gpt-5.2-2025-12-11")
        self.openai_base_url = self.values.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        self.jev_model = self.values.get("JEV_MODEL", "jev-1.13.0")
        self.semif_base_url = self.values.get("SEMIF_BASE_URL", "http://127.0.0.1:8019").rstrip("/")
        self.semif_python = self.values.get("SEMIF_PYTHON", "")
        self.db_path = Path(self.values.get("BENCHMARK_DB", str(ROOT / "artifacts/runs.sqlite3")))

    def key(self, provider: str) -> str:
        if provider == "semif":
            return ""  # Local scoring does not use an API key.
        prefix = "OPENAI" if provider == "openai" else "TYPESAFE"
        direct = self.values.get(f"{prefix}_API_KEY")
        if direct:
            return direct
        source = self.values.get(f"{prefix}_ENV_FILE")
        name = self.values.get(f"{prefix}_KEY_NAME", f"{prefix}_API_KEY")
        if source and Path(source).is_file():
            return dotenv_values(source).get(name) or ""
        return ""

    def price(self, provider: str) -> dict:
        if provider == "semif":
            return {"input": 0.0, "cached_input": 0.0, "output": 0.0}
        if provider == "jev":
            defaults = {"input": 0.042, "cached_input": 0.042, "output": 0.0}
            prefix = "JEV"
        else:
            defaults = {"input": 1.75, "cached_input": .175, "output": 14.0}
            prefix = "OPENAI"
        return {kind: float(self.values.get(f"{prefix}_{kind.upper()}_PRICE", value))
                for kind, value in defaults.items()}

    def providers(self) -> list[dict]:
        return [
            {"id": "semif", "name": "SemIf", "model": SEMIF_MODEL + " · MLX BF16",
             "configured": bool(self.semif_base_url), "pricing": self.price("semif")},
            {"id": "openai", "name": "GPT", "model": self.openai_model,
             "configured": bool(self.key("openai")), "pricing": self.price("openai")},
        ]
