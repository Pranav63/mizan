.PHONY: setup dev test build

setup:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements.lock -e . --no-deps
	cd frontend && npm ci

dev:
	.venv/bin/python scripts/dev.py

test:
	.venv/bin/python -m pytest -q

build:
	cd frontend && npm run build
