import json

from openai import AsyncOpenAI

from app.config import Settings
from app.utils.errors import AppError


class LLMService:
    def __init__(self, settings: Settings):
        if not settings.openai_api_key:
            raise AppError("OPENAI_API_KEY is required for generation.", status_code=500, code="missing_openai_key")
        self.settings = settings
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def complete_json(self, system: str, user: str) -> dict:
        response = await self.client.chat.completions.create(
            model=self.settings.llm_model,
            temperature=self.settings.llm_temperature,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        content = response.choices[0].message.content or "{}"
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise AppError(f"LLM returned invalid JSON: {exc}", status_code=502, code="invalid_llm_json") from exc

