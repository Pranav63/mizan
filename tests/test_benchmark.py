import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.dataset import DATA, LABELS, samples
from backend.metrics import summarize
from backend.providers import ProviderError, classify, demo_prediction
from backend.storage import RunStore


def rows(pair_limit=1, provider="demo_a"):
    result = []
    for sample in samples(pair_limit):
        prediction = demo_prediction(sample, provider)
        latency = prediction.pop("fixture_latency_ms")
        result.append(sample | prediction | {"provider": provider, "error": None, "latency_ms": latency, "cost_usd": 0})
    return result


def test_dataset_has_balanced_aligned_triplets():
    assert len(DATA["pairs"]) == 20
    assert len(samples(20)) == 60
    assert len({s["id"] for s in samples(20)}) == 60
    assert all(set(pair["texts"]) == {"en", "ar", "mixed"} for pair in DATA["pairs"])
    assert all(sum(p["label"] == label for p in DATA["pairs"]) == 4 for label in LABELS)
    assert {s["label"] for s in samples(5)} == set(LABELS)


def test_matching_wrong_predictions_are_consistent_but_incorrect():
    result = rows()
    for row in result:
        row["predicted"] = "permission"
    summary = summarize(result, list(LABELS))
    assert summary["consistency"] == 1
    assert summary["all_languages_correct"] == 0
    assert summary["accuracy"] == 0


def test_failures_count_as_misses_and_do_not_create_false_agreement():
    result = rows()
    result[1]["predicted"] = None
    result[1]["error"] = "Timed out"
    summary = summarize(result, list(LABELS))
    assert summary["accuracy"] == pytest.approx(2 / 3)
    assert summary["error_count"] == 1
    assert summary["per_language"]["ar"]["accuracy"] == 0
    assert summary["consistency"] == 0
    assert summary["confusion_matrix"]["obligation"]["error"] == 1
    for row in result:
        row["predicted"], row["error"] = None, "Failed"
    assert summarize(result, list(LABELS))["consistency"] == 0


def test_incomplete_pairs_have_no_agreement_score():
    assert summarize(rows()[:2], list(LABELS))["consistency"] is None


@pytest.mark.parametrize("provider", ["jev", "openai"])
def test_provider_contract_and_no_ground_truth_leak(provider):
    settings = Settings()
    settings.key = lambda _: "test-secret"
    sample = samples(1)[0]

    def handler(request):
        body = json.loads(request.content)
        assert request.headers["authorization"] == "Bearer test-secret"
        assert sample["id"] not in json.dumps(body)
        assert '"label": "obligation"' not in json.dumps(body)
        assert sample["text"] in json.dumps(body)
        if provider == "jev":
            assert body["questions"]["classification"]["criteria"] == LABELS
            return httpx.Response(200, json={"model": "jev-1.13.0", "answers": {"classification": {
                "type": "choice", "choice": "obligation", "probabilities": {"obligation": .98}, "confidence": .9}},
                "usage": {"input_tokens": 100, "output_tokens": 20}})
        assert body["store"] is False
        assert body["reasoning"] == {"effort": "none"}
        assert body["text"]["format"]["schema"]["properties"]["label"]["enum"] == list(LABELS)
        return httpx.Response(200, json={"status": "completed", "model": settings.openai_model,
            "output": [{"type": "message", "content": [{"type": "output_text", "text": '{"label":"obligation"}'}]}],
            "usage": {"input_tokens": 150, "output_tokens": 10, "input_tokens_details": {"cached_tokens": 50}}})

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await classify(client, provider, sample["text"], settings)
    prediction = asyncio.run(check())
    assert prediction["predicted"] == "obligation"
    assert (prediction["probabilities"] is None) == (provider == "openai")
    assert prediction["usage"]["cached_input_tokens"] == (50 if provider == "openai" else 0)


def test_provider_error_does_not_persist_response_body():
    settings = Settings()
    settings.key = lambda _: "test-secret"

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda _: httpx.Response(401, json={"error": "sensitive-echo test-secret"}))) as client:
            await classify(client, "jev", "test", settings)
    with pytest.raises(ProviderError) as exc:
        asyncio.run(check())
    assert "HTTP 401" in str(exc.value)
    assert "sensitive-echo" not in str(exc.value)
    assert "test-secret" not in str(exc.value)


def test_demo_run_progress_export_and_missing_key(tmp_path, monkeypatch):
    import backend.main as main
    monkeypatch.setattr(main, "store", RunStore(tmp_path / "runs.sqlite3"))
    monkeypatch.setattr(main.settings, "key", lambda _: "")
    with TestClient(main.app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        denied = client.post("/api/runs", json={"mode": "live", "pair_limit": 5})
        assert denied.status_code == 400
        response = client.post("/api/runs", json={"mode": "demo", "pair_limit": 5})
        assert response.status_code == 202
        run = client.get("/api/runs/" + response.json()["id"]).json()
        assert run["status"] == "completed"
        assert run["completed"] == run["expected"] == 30
        assert run["providers"] == ["demo_a", "demo_b"]
        assert run["summary"]["demo_a"]["accuracy"] == 1
        assert len(run["prompt_hash"]) == len(run["dataset_hash"]) == 64
        exported = client.get(f'/api/runs/{run["id"]}/export').json()
        assert exported["demo_note"]
        assert len(exported["results"]) == 30
        csv = client.get(f'/api/runs/{run["id"]}/export?format=csv')
        assert "attachment" in csv.headers["content-disposition"]
        assert "policy-01-en" in csv.text
        assert "Bearer" not in json.dumps(exported)
        assert client.get("/api/runs/not-a-run").status_code == 404


def test_budget_rejects_before_external_calls(tmp_path, monkeypatch):
    import backend.main as main
    monkeypatch.setattr(main, "store", RunStore(tmp_path / "runs.sqlite3"))
    monkeypatch.setattr(main.settings, "key", lambda _: "test-secret")
    with TestClient(main.app) as client:
        response = client.post("/api/runs", json={"mode": "live", "providers": ["openai"], "pair_limit": 20, "budget_usd": .000001})
        assert response.status_code == 400
        assert "budget" in response.json()["detail"]
        assert not main.store.list()


def test_interrupted_runs_do_not_poll_forever(tmp_path):
    path = tmp_path / "runs.sqlite3"
    store = RunStore(path)
    store.save({"id": "unfinished", "status": "running", "created_at": "2026-10-06"})
    restored = RunStore(path)
    assert restored.get("unfinished")["status"] == "interrupted"


def test_cached_tokens_are_priced_separately():
    from backend.main import cost
    assert cost({"input_tokens": 200, "cached_input_tokens": 100, "output_tokens": 10},
                {"input": .4, "cached_input": .1, "output": 1.6}) == pytest.approx(.000066)



def test_fatal_provider_access_error_stops_further_requests(tmp_path, monkeypatch):
    import backend.main as main
    monkeypatch.setattr(main, "store", RunStore(tmp_path / "runs.sqlite3"))
    monkeypatch.setattr(main.settings, "key", lambda _: "test-secret")
    calls = []

    async def denied(*args):
        calls.append(True)
        raise ProviderError("Provider returned HTTP 403.", status_code=403)

    monkeypatch.setattr(main, "classify", denied)
    with TestClient(main.app) as client:
        response = client.post("/api/runs", json={"mode": "live", "providers": ["openai"],
                                               "pair_limit": 5, "budget_usd": .50})
        assert response.status_code == 202
        run = client.get("/api/runs/" + response.json()["id"]).json()
    assert len(calls) == 1
    assert run["status"] == "failed"
    assert run["completed"] == 1
    assert run["expected"] == 15
    assert run["summary"]["openai"]["error_count"] == 1


def test_cancelled_queued_run_never_calls_provider(tmp_path, monkeypatch):
    import backend.main as main
    monkeypatch.setattr(main, "store", RunStore(tmp_path / "runs.sqlite3"))
    calls = []

    async def unused(*args):
        calls.append(True)
        raise AssertionError("A cancelled run must not call the model")

    monkeypatch.setattr(main, "classify", unused)
    run = main.make_run(main.RunRequest(mode="live", providers=["openai"], pair_limit=5))
    run["status"] = "cancelled"
    main.store.save(run)
    asyncio.run(main.execute(run["id"]))
    assert not calls
    assert main.store.get(run["id"])["status"] == "cancelled"


@pytest.mark.parametrize("invalid", [None, "revision", "probabilities"])
def test_semif_local_contract_and_provenance(invalid):
    from backend.config import SEMIF_MODEL, SEMIF_REVISION
    settings = Settings()
    settings.key = lambda _: ""
    sample = samples(1)[0]

    def handler(request):
        assert "authorization" not in request.headers
        body = json.loads(request.content)
        assert body["state"] == sample["text"]
        assert set(body) == {"id", "state", "question", "options"}
        assert body["id"] != sample["id"]
        assert body["options"] == [{"id": k, "description": v} for k, v in LABELS.items()]
        return httpx.Response(200, json={
            "model": {"source": SEMIF_MODEL, "revision": "wrong" if invalid == "revision" else SEMIF_REVISION,
                      "backend": "mlx", "quantization": None, "semif_commit": "source-commit"},
            "option_ids": list(LABELS), "probabilities": [1, 1, 0, 0, 0] if invalid == "probabilities" else [.8, .05, .05, .05, .05],
            "prompt_sha256": "a" * 64, "prompt_version": "direct-options-v1",
            "total_seconds": .5, "input_tokens": 120, "probability_status": "uncalibrated",
        })

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await classify(client, "semif", sample["text"], settings)

    if invalid:
        with pytest.raises(ProviderError):
            asyncio.run(check())
    else:
        prediction = asyncio.run(check())
        assert prediction["predicted"] == "obligation"
        assert prediction["confidence"] is None
        assert prediction["usage"]["output_tokens"] == 0
        assert prediction["model_metadata"]["semif_commit"] == "source-commit"
        assert settings.price("semif") == {"input": 0, "cached_input": 0, "output": 0}


def test_unavailable_local_scorer_rejects_before_run(tmp_path, monkeypatch):
    import backend.main as main
    monkeypatch.setattr(main, "store", RunStore(tmp_path / "runs.sqlite3"))
    monkeypatch.setattr(main.settings, "key", lambda _: "")

    async def unavailable(*args, **kwargs):
        raise httpx.ConnectError("local service is down")

    monkeypatch.setattr(httpx.AsyncClient, "get", unavailable)
    with TestClient(main.app) as client:
        response = client.post("/api/runs", json={"mode": "live", "providers": ["semif"], "pair_limit": 5})
    assert response.status_code == 400
    assert "SemIf is not ready" in response.json()["detail"]
    assert not main.store.list()
