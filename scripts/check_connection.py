"""Check configured model access without printing keys, response bodies or account data."""
import asyncio
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.config import Settings


async def main():
    settings = Settings()
    async with httpx.AsyncClient(timeout=20) as client:
        for provider in settings.providers():
            if provider["id"] == "semif":
                try:
                    response = await client.get(settings.semif_base_url + "/health")
                    response.raise_for_status()
                    print("SemIf: " + response.json()["status"] + " · " + response.json()["model"]["source"])
                except (httpx.HTTPError, ValueError, KeyError):
                    print("SemIf: local scorer not ready; start make dev")
                continue
            key = settings.key(provider["id"])
            if not key:
                print(provider["name"] + ": key needed")
                continue
            url = settings.openai_base_url + "/models/" + settings.openai_model
            try:
                response = await client.get(url, headers={"Authorization": "Bearer " + key})
                print(provider["name"] + f": access check HTTP {response.status_code}")
            except httpx.RequestError:
                print(provider["name"] + ": access check could not connect")


if __name__ == "__main__":
    asyncio.run(main())
