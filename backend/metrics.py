from collections import defaultdict
from math import ceil
from statistics import median


def summarize(rows: list[dict], label_ids: list[str]) -> dict:
    if not rows:
        return {}
    successes = [row for row in rows if row["error"] is None]
    correct = sum(row["predicted"] == row["label"] and row["error"] is None for row in rows)
    f1s = []
    for label in label_ids:
        tp = sum(r["label"] == label and r["predicted"] == label and not r["error"] for r in rows)
        fp = sum(r["label"] != label and r["predicted"] == label and not r["error"] for r in rows)
        fn = sum(r["label"] == label and (r["predicted"] != label or r["error"] is not None) for r in rows)
        f1s.append(2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0)
    by_lang = {}
    for lang in ("en", "ar", "mixed"):
        subset = [r for r in rows if r["language"] == lang]
        by_lang[lang] = {
            "total": len(subset),
            "accuracy": sum(r["predicted"] == r["label"] and not r["error"] for r in subset) / len(subset)
            if subset else None,
        }
    pairs = defaultdict(list)
    for row in rows:
        pairs[row["pair_id"]].append(row)
    complete = [group for group in pairs.values() if {r["language"] for r in group} == {"en", "ar", "mixed"}]
    consistent = sum(all(not r["error"] for r in group) and len({r["predicted"] for r in group}) == 1
                     for group in complete)
    pair_correct = sum(all(not r["error"] and r["predicted"] == r["label"] for r in group)
                       for group in complete)
    latencies = sorted(r["latency_ms"] for r in successes)
    matrix = {label: {prediction: 0 for prediction in [*label_ids, "error"]} for label in label_ids}
    for row in rows:
        matrix[row["label"]]["error" if row["error"] else row["predicted"]] += 1
    return {
        "total": len(rows), "correct": correct, "accuracy": correct / len(rows),
        "macro_f1": sum(f1s) / len(f1s), "error_count": len(rows) - len(successes),
        "per_language": by_lang,
        "language_gap": abs(by_lang["en"]["accuracy"] - by_lang["ar"]["accuracy"])
        if by_lang["en"]["accuracy"] is not None and by_lang["ar"]["accuracy"] is not None else None,
        "pair_count": len(complete),
        "consistency": consistent / len(complete) if complete else None,
        "all_languages_correct": pair_correct / len(complete) if complete else None,
        "p50_latency_ms": median(latencies) if latencies else None,
        "p95_latency_ms": latencies[max(0, ceil(len(latencies) * .95) - 1)] if latencies else None,
        "input_tokens": sum(r["usage"]["input_tokens"] for r in successes),
        "output_tokens": sum(r["usage"]["output_tokens"] for r in successes),
        "estimated_cost_usd": sum(r["cost_usd"] for r in successes),
        "confusion_matrix": matrix,
    }
