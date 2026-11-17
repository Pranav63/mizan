import asyncio
import csv
import io
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .config import SEMIF_MODEL, SEMIF_REVISION, Settings
from .dataset import DATA, DATASET_HASH, INSTRUCTIONS, LABELS, PROMPT_HASH, metadata, samples
from .metrics import summarize
from .providers import ProviderError, classify, demo_prediction
from .storage import RunStore

settings = Settings()
store = RunStore(settings.db_path)
app = FastAPI(title="Mizan Benchmark API", version="0.1.0")


class RunRequest(BaseModel):
    mode: Literal["demo", "live"] = "demo"
    providers: list[Literal["semif", "jev", "openai"]] = Field(default=["semif", "openai"], min_length=1, max_length=2)
    pair_limit: int = Field(default=20, ge=1, le=len(DATA["pairs"]))
    budget_usd: float = Field(default=.50, gt=0, le=5)


def totals(run):
    run["summary"] = {p: summarize([r for r in run["results"] if r["provider"] == p], list(LABELS))
                      for p in run["providers"]}
    run["completed"] = len(run["results"])


def cost(usage, pricing):
    cached = usage.get("cached_input_tokens", 0)
    return ((usage["input_tokens"] - cached) * pricing["input"] + cached * pricing["cached_input"]
            + usage["output_tokens"] * pricing["output"]) / 1_000_000


def cost_upper_bound(items, providers):
    # UTF-8 byte count is a conservative upper bound for these tokenizers.
    rubric_bytes = len((INSTRUCTIONS + json.dumps(LABELS)).encode()) + 512
    return sum((len(item["text"].encode()) + rubric_bytes) * settings.price(p)["input"] / 1_000_000
               + 128 * settings.price(p)["output"] / 1_000_000
               for item in items for p in providers)


async def execute(run_id: str):
    run = store.get(run_id)
    if run["status"] == "cancelled":
        return
    run["status"] = "running"
    store.save(run)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for item in samples(run["pair_limit"]):
                for provider in run["providers"]:
                    if store.get(run_id)["status"] == "cancelled":
                        return
                    started = time.perf_counter()
                    error = None
                    fatal_access_error = False
                    try:
                        if run["mode"] == "demo":
                            prediction = demo_prediction(item, provider)
                            await asyncio.sleep(.012)
                        else:
                            # Ground truth and paired variants are never passed to the model.
                            prediction = await classify(client, provider, item["text"], settings)
                    except ProviderError as exc:
                        error = str(exc)
                        fatal_access_error = exc.status_code in (401, 403, 404, 422) or (provider == "semif" and exc.status_code == 503)
                        prediction = {"predicted": None, "model": run["models"][provider],
                                      "probabilities": None, "confidence": None,
                                      "usage": {"input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0}}
                    latency = prediction.pop("fixture_latency_ms", (time.perf_counter() - started) * 1000)
                    run["results"].append(item | prediction | {
                        "provider": provider, "error": error, "latency_ms": round(latency, 2),
                        "cost_usd": 0 if run["mode"] == "demo" else cost(prediction["usage"], run["pricing"][provider])})
                    totals(run)
                    # Cancellation can arrive while an HTTP request is in flight.
                    if store.get(run_id)["status"] == "cancelled":
                        run["status"] = "cancelled"
                        store.save(run)
                        return
                    store.save(run)
                    if fatal_access_error:
                        run["status"] = "failed"
                        run["failure"] = "Provider access or model configuration failed. No further requests were sent."
                        run["finished_at"] = datetime.now(timezone.utc).isoformat()
                        store.save(run)
                        return
        run["status"] = "completed_with_errors" if any(r["error"] for r in run["results"]) else "completed"
        run["finished_at"] = datetime.now(timezone.utc).isoformat()
    except Exception:
        run["status"] = "failed"
        run["failure"] = "The benchmark worker stopped unexpectedly. Partial results were retained."
    totals(run)
    store.save(run)


def make_run(request: RunRequest):
    live_providers = list(dict.fromkeys(request.providers))
    providers = live_providers if request.mode == "live" else [
        "demo_a" if p in ("jev", "semif") else "demo_b" for p in live_providers]
    providers = list(dict.fromkeys(providers))
    model_names = {"semif": SEMIF_MODEL + " · MLX BF16", "jev": settings.jev_model, "openai": settings.openai_model}
    return {
        "id": uuid.uuid4().hex[:12], "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": request.mode, "status": "queued", "providers": providers,
        "models": {p: model_names[p]
                   if request.mode == "live" else f"{p}-fixture-v1" for p in providers},
        "pricing": {p: settings.price(p) for p in providers} if request.mode == "live" else {},
        "pair_limit": request.pair_limit, "budget_usd": request.budget_usd,
        "expected": request.pair_limit * 3 * len(providers), "completed": 0,
        "dataset": metadata(), "dataset_hash": DATASET_HASH, "prompt_hash": PROMPT_HASH,
        "instructions": INSTRUCTIONS, "rubric": LABELS, "results": [], "summary": {},
        "cost_note": "API-token estimate using saved rates. SemIf has no API fee; local hardware and electricity are excluded. Failed hosted calls may have unreported billable usage.",
        "demo_note": "Illustrative fixture predictions and latency; no provider calls or actual model measurements."
        if request.mode == "demo" else None,
        "protocol": {"concurrency": 1, "retries": 0, "temperature": {"openai": 0, "jev": None},
                     "endpoints": {"openai": settings.openai_base_url, "jev": "https://api.typesafe.ai/v1", "semif": settings.semif_base_url},
                     "semif": {"model": SEMIF_MODEL, "revision": SEMIF_REVISION, "backend": "mlx", "mode": "direct", "quantization": None, "timing": "Warm resident model; loading and warm-up excluded. End-to-end loopback request included."},
                     "reasoning_effort": {"openai": "none"}, "max_output_tokens": {"openai": 128}, "pricing_checked_on": "2026-10-06",
                     "evaluation": "closed-set policy-clause classification"},
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    return {"providers": settings.providers(), "dataset": metadata(), "default_budget_usd": .50}


@app.get("/api/dataset")
def dataset():
    return {"metadata": metadata(), "samples": samples(len(DATA["pairs"]))}


@app.get("/api/runs")
def runs():
    return [{key: value for key, value in run.items() if key not in ("results", "instructions", "rubric")}
            for run in store.list()]


@app.post("/api/runs", status_code=202)
async def create_run(request: RunRequest, tasks: BackgroundTasks):
    if any(r["status"] in ("queued", "running") for r in store.list()):
        raise HTTPException(409, "A benchmark is already running. Wait or cancel it first.")
    if request.mode == "live":
        missing = [p for p in request.providers if p != "semif" and not settings.key(p)]
        if missing:
            raise HTTPException(400, "Configure these providers first: " + ", ".join(missing))
        bound = cost_upper_bound(samples(request.pair_limit), list(dict.fromkeys(request.providers)))
        if bound > request.budget_usd:
            raise HTTPException(400, f"Conservative estimated cost ${bound:.4f} exceeds this run's budget.")
        if "semif" in request.providers:
            try:
                async with httpx.AsyncClient(timeout=3) as client:
                    response = await client.get(settings.semif_base_url + "/health")
                    response.raise_for_status()
                    local = response.json()
                    if local["status"] != "ready" or local["model"]["source"] != SEMIF_MODEL or local["model"]["revision"] != SEMIF_REVISION:
                        raise ValueError("Unexpected local baseline")
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                raise HTTPException(400, "SemIf is not ready. Start the local scoring service with make dev, then retry.") from None
    run = make_run(request)
    store.save(run)
    tasks.add_task(execute, run["id"])
    return run


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    run = store.get(run_id)
    if not run:
        raise HTTPException(404, "Benchmark run not found.")
    return run


@app.post("/api/runs/{run_id}/cancel")
async def cancel(run_id: str):
    run = get_run(run_id)
    if run["status"] in ("queued", "running"):
        run["status"] = "cancelled"
        store.save(run)
    return run


@app.get("/api/runs/{run_id}/export")
def export(run_id: str, format: Literal["json", "csv"] = "json"):
    run = get_run(run_id)
    if format == "json":
        content = json.dumps(run, ensure_ascii=False, indent=2)
        media = "application/json"
    else:
        output = io.StringIO()
        fields = ["id", "pair_id", "language", "label", "provider", "model", "predicted", "latency_ms", "cost_usd", "error", "text"]
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(run["results"])
        content, media = output.getvalue(), "text/csv; charset=utf-8"
    return Response(content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="mizan-{run_id}.{format}"'})


# A deliberate, clearly labelled fixture run makes the first visit useful without API keys.
if not store.list():
    initial = make_run(RunRequest())
    initial["id"] = "demo-starter"
    initial["status"] = "completed"
    for item in samples(initial["pair_limit"]):
        for provider in initial["providers"]:
            result = demo_prediction(item, provider)
            latency = result.pop("fixture_latency_ms")
            initial["results"].append(item | result | {
                "provider": provider, "latency_ms": latency, "cost_usd": 0.0, "error": None})
    totals(initial)
    store.save(initial)
