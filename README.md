# Mizan · ميزان

An Arabic–English policy-classification benchmark comparing **local SemIf / Qwen3.5-4B** with a **GPT-5.2 baseline**. React + TypeScript + Vite frontend, FastAPI backend, SQLite run history.

The first dataset contains **20 meaning-aligned triplets / 60 synthetic clauses**, covering obligations, prohibitions, permissions, definitions and procedures. Each triplet has English, Modern Standard Arabic and mixed-language variants. Negation, exceptions and quoted instructions appear in the challenge subset.

## Start locally

Requires Python 3.11+ and Node 22.12+.

```sh
make setup  # First-time dependency installation only.
./start.sh
```

`start.sh` starts the frontend, backend and configured SemIf scorer. You can also invoke it by its full path from another directory. `make dev` remains available.

Running it again while Mizan is active prints the existing workspace URL and exits without starting duplicate servers. Other port conflicts are reported before startup. Ctrl+C or termination stops the launched servers and the frontend's child process.

Open **http://127.0.0.1:5178**. API documentation: **http://127.0.0.1:8018/docs**. Ctrl+C stops the UI, API and configured local scorer. Run one backend process; the local benchmark runner is not a distributed worker queue.

The UI uses a pearl-and-indigo theme with a floating glass navigation layer and opaque reading/results surfaces. Overview introduces the three-language comparison; Dataset presents a policy atlas; Runs keeps an expandable experiment journal; Method offers an interactive protocol map with one chapter open at a time. Language breakdowns, detailed metrics, clause results and the confusion matrix open on demand. Dataset browsing reveals six clauses at a time; run history starts with four records.

Navigation uses native View Transitions where supported, with a CSS fallback. Decorative motion can be paused across the app; system reduced-motion, reduced-transparency and increased-contrast preferences are respected. Mobile navigation becomes a floating bottom dock. Material placement and contextual movement follow [Apple’s Liquid Glass guidance](https://developer.apple.com/videos/play/wwdc2025/219/), adapted for the web.

The first visit opens an explicitly labelled **demo fixture replay**. Its predictions and latency are illustrative, not measurements of actual models. No API key or model call is needed for the demo.

## Connect models

Copy `.env.example` to `.env` if no local `.env` exists. **No Jev key is needed.** SemIf is an independent open-source implementation of typed semantic decisions, not Jev's model or service.

Install [SemIf](https://github.com/TheoLeeCJ/SemIf) in its own environment with `pip install -e '.[test,mlx]'` on Apple Silicon. Point Mizan at that interpreter:

```dotenv
SEMIF_PYTHON=/absolute/path/to/SemIf/.venv/bin/python
SEMIF_BASE_URL=http://127.0.0.1:8019

OPENAI_ENV_FILE=/absolute/path/to/existing/.env
OPENAI_KEY_NAME=OPENAI_API_KEY
OPENAI_BASE_URL=https://api.openai.com/v1
```

On this machine, the existing Downloads/SemIf environment and cached checkpoint are reused. `make dev` starts a loopback-only scoring bridge on port 8019. It loads the pinned `Qwen/Qwen3.5-4B` revision `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`, preserves source precision (BF16 with some FP32 parameters), performs a warm-up, then serves sequential direct-logit decisions with zero generated tokens. An initial setup on another machine downloads approximately 9 GB of weights. The bridge must use SemIf's environment, rather than Mizan's lightweight API environment.

SemIf's native prompt wrapper differs from GPT's schema wrapper. Both receive the same task instructions, option definitions and isolated evidence. Each local result retains its actual rendered prompt hash, SemIf source commit, runtime versions, source artifact hashes, hardware and quantization status. Scores are conditional on the supplied options and are not calibrated confidence.

Machine-specific configuration lives in `.env`, which Git ignores. The template uses the global OpenAI endpoint; select the endpoint appropriate to your key and region.

Restart the backend after changing configuration. **Connections** shows the local endpoint configuration and whether the GPT key is present. A live run checks local readiness before it is queued; GPT account access is verified by the model request. To check access without inference calls:

```sh
.venv/bin/python scripts/check_connection.py
```

Choose **New run → Live models**, select the configured providers, and start with **Quick check** (15 clauses / one triplet per class). The full starter corpus contains 60 clauses. The default per-run ceiling is $0.50, enforced with a conservative token-cost estimate before a live run starts. An in-flight request can finish after cancellation; no subsequent request starts. Access and configuration errors stop a run after its first failed request.

Keys are read by the backend. Never use a `VITE_` prefix for secrets. Dataset contents are sent to the selected provider only in live mode. Model output is not stored by OpenAI (`store: false`); this is not a claim of zero provider retention.

## What the dashboard measures

| Metric | Definition |
|---|---|
| Accuracy | Correct classifications / all attempts; failures are misses. |
| Macro F1 | Unweighted F1 across all five classes. |
| Language accuracy | Separate scores for English, Arabic and mixed text. |
| EN–AR gap | Absolute difference in percentage points. |
| Triplet agreement | All three language variants successfully receive the same label. |
| All languages correct | Every member of a complete triplet matches ground truth. |
| p50 / p95 latency | Successful request times, with sequential calls and no automatic retry. |
| Estimated API cost | Hosted token usage × saved rates. SemIf has no API fee; local hardware and electricity are excluded. |

Local timings include the loopback request, prompt construction and warm inference, excluding model loading and warm-up. GPT timings include network and hosted inference. These are practical end-to-end measurements on different execution systems, not a controlled hardware comparison.

Agreement can be high even when every prediction is wrong. Failed requests can have unreported billable usage. SemIf probabilities are retained per clause; GPT is not asked to generate a confidence score because it would not be a comparable calibrated probability.

Each run exports JSON with the rubric, protocol, dataset/prompt hashes, requested and returned model versions, individual predictions, failures and usage. CSV exports a flat prediction table. SQLite history and screenshots live under ignored `artifacts/`.

## Research boundaries

This is a **synthetic starter corpus awaiting bilingual expert review**. One run does not establish a universal model ranking. Instructions and rubrics are held constant in English, while clause language changes. These results therefore test this specific English-instruction classification setup, not Arabic instruction following in general. The unit is a policy clause, not a full PDF or document.

For publishable findings, review the translations and labels with a bilingual domain expert, build a held-out corpus, and repeat experiments across prompts and runs. Start with the reproducible protocol before expanding to additional models.

## Verify

```sh
make test
make build
cd frontend
npx playwright install chromium
npm run test:e2e
```

The browser checks require both servers running. To use an already-installed Chromium executable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Tests exercise scoring failures, provider request/response contracts, budget enforcement, exports, Arabic direction, mobile layout and accessibility. No backend test makes paid model calls.

## References

- [SemIf](https://github.com/TheoLeeCJ/SemIf) and its [MLX backend](https://github.com/TheoLeeCJ/SemIf/blob/master/docs/MLX.md): direct option logits, pinned source model, Apple Silicon runtime and probability limitations.
- [GPT structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses API with a strict label schema.
- [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2): pinned `gpt-5.2-2025-12-11`, baseline capabilities and pricing.

Prices were checked on 2026-10-06 and are configurable in `.env`; verify them before publishing cost comparisons.
