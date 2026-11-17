import json
import math

import httpx

from .dataset import INSTRUCTIONS, LABELS
from .config import SEMIF_MODEL, SEMIF_REVISION


class ProviderError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def demo_prediction(sample: dict, provider: str) -> dict:
    # These are explicitly illustrative fixtures, never model measurements.
    number = int(sample["pair_id"].split("-")[-1])
    fixtures = {"demo_a": {(7, "ar"): "permission", (13, "mixed"): "obligation", (19, "en"): "procedure"},
                "demo_b": {(6, "ar"): "permission", (9, "mixed"): "obligation", (12, "ar"): "procedure",
                           (17, "mixed"): "permission", (20, "en"): "prohibition"}}
    label = fixtures[provider].get((number, sample["language"]), sample["label"])
    return {"predicted": label, "model": f"{provider}-fixture-v1", "probabilities": None,
            "confidence": None, "usage": {"input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0},
            "fixture_latency_ms": (24 if provider == "demo_a" else 170) + number * 3}


async def classify(client: httpx.AsyncClient, provider: str, text: str, settings) -> dict:
    key = settings.key(provider)
    if provider != "semif" and not key:
        raise ProviderError("Provider key is not configured. Add its local environment-file reference.")
    if provider == "semif":
        url = settings.semif_base_url + "/score"
        body = {"id": "classification", "state": text, "question": INSTRUCTIONS,
                "options": [{"id": label, "description": description} for label, description in LABELS.items()]}
    elif provider == "jev":
        url = "https://api.typesafe.ai/v1/systemone"
        body = {"model": settings.jev_model, "state": text,
                "questions": {"classification": {"type": "choice", "instructions": INSTRUCTIONS,
                                                  "criteria": LABELS}}}
    else:
        url = settings.openai_base_url + "/responses"
        body = {"model": settings.openai_model, "store": False, "temperature": 0,
                "max_output_tokens": 128, "reasoning": {"effort": "none"},
                "input": [{"role": "system", "content": INSTRUCTIONS + "\nRubric: " + json.dumps(LABELS)},
                          {"role": "user", "content": text}],
                "text": {"format": {"type": "json_schema", "name": "policy_classification", "strict": True,
                                    "schema": {"type": "object", "properties": {
                                        "label": {"type": "string", "enum": list(LABELS)}},
                                        "required": ["label"], "additionalProperties": False}}}}
    try:
        response = await client.post(url, headers={"Authorization": f"Bearer {key}"} if key else {}, json=body)
        response.raise_for_status()
        data = response.json()
        if provider == "semif":
            metadata = data["model"]
            if metadata["source"] != SEMIF_MODEL or metadata["revision"] != SEMIF_REVISION or metadata["backend"] != "mlx" or metadata.get("quantization"):
                raise ProviderError("Local model does not match the pinned MLX BF16 baseline.", status_code=422)
            ids, scores = data["option_ids"], data["probabilities"]
            if ids != list(LABELS) or len(scores) != len(ids) or any(not math.isfinite(p) or not 0 <= p <= 1 for p in scores) or not math.isclose(sum(scores), 1, abs_tol=1e-5):
                raise ProviderError("Local model returned an invalid option distribution.")
            probabilities = dict(zip(ids, scores))
            label = max(probabilities, key=probabilities.get)
            return {"predicted": label, "model": SEMIF_MODEL, "model_metadata": metadata,
                    "probabilities": probabilities, "confidence": None,
                    "prompt_sha256": data["prompt_sha256"], "prompt_version": data["prompt_version"],
                    "probability_status": data["probability_status"],
                    "local_scoring_seconds": data["total_seconds"],
                    "usage": {"input_tokens": data["input_tokens"], "output_tokens": 0, "cached_input_tokens": 0}}
        if provider == "jev":
            answer = data["answers"]["classification"]
            label = answer["choice"]
            probabilities = answer.get("probabilities")
            confidence = answer.get("confidence")
        else:
            if data.get("status") != "completed":
                raise ProviderError("Provider did not complete the classification.")
            output = "".join(item["text"] for message in data.get("output", [])
                             for item in message.get("content", []) if item.get("type") == "output_text")
            if not output:
                raise ProviderError("Provider returned no classification (possibly a refusal).")
            label = json.loads(output)["label"]
            probabilities = confidence = None  # Generated confidence is not a comparable probability.
        if label not in LABELS:
            raise ProviderError("Provider returned a label outside the rubric.")
        usage = data.get("usage", {})
        return {"predicted": label, "model": data.get("model", body["model"]),
                "probabilities": probabilities, "confidence": confidence,
                "usage": {"input_tokens": usage.get("input_tokens", 0),
                          "output_tokens": usage.get("output_tokens", 0),
                          "cached_input_tokens": usage.get("input_tokens_details", {}).get("cached_tokens", 0)}}
    except httpx.HTTPStatusError as exc:
        # Do not persist vendor response bodies: they can echo sensitive request material.
        raise ProviderError(f"Provider returned HTTP {exc.response.status_code}. Check access, quota or rate limits.",
                            status_code=exc.response.status_code) from None
    except httpx.RequestError:
        raise ProviderError("Provider connection failed or timed out.") from None
    except (KeyError, ValueError, TypeError):
        raise ProviderError("Provider returned an unexpected response format.") from None
