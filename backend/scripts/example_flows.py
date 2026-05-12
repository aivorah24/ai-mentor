import asyncio
import json

import httpx

BASE_URL = "http://localhost:8000/api/v1"


async def main() -> None:
    ingestion_payload = {
        "items": [
            {
                "source_id": "teacher-created-g3-science-plants-001",
                "title": "Grade 3 Science - Parts of a Plant",
                "text": (
                    "Plants usually have roots, stems, leaves, flowers, fruits, and seeds. "
                    "Roots hold the plant in the soil and take in water. Stems carry water to the leaves. "
                    "Leaves make food for the plant using sunlight."
                ),
                "metadata": {
                    "curriculum": "NCERT",
                    "grade": 3,
                    "subject": "Science",
                    "topic": "Plants",
                    "learning_objective": "Identify basic plant parts and describe their functions.",
                    "difficulty": "easy",
                    "bloom_taxonomy": "understand",
                    "license_status": "teacher_created",
                    "tags": ["plants", "living things"],
                },
            }
        ]
    }

    retrieval_payload = {
        "query": "plant parts and their functions",
        "filters": {"grade": 3, "subject": "Science"},
        "limit": 5,
    }

    worksheet_payload = {
        "topic": "Plants",
        "grade": 3,
        "subject": "Science",
        "filters": {"curricula": ["NCERT"]},
        "questions_per_type": 2,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        for path, payload in [
            ("/ingestion", ingestion_payload),
            ("/retrieval/search", retrieval_payload),
            ("/worksheets/generate", worksheet_payload),
        ]:
            response = await client.post(f"{BASE_URL}{path}", json=payload)
            response.raise_for_status()
            print(f"\n{path}\n{json.dumps(response.json(), indent=2)}")


if __name__ == "__main__":
    asyncio.run(main())

