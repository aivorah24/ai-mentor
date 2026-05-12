from app.services.llm_service import LLMService


class SimplificationService:
    def __init__(self, llm: LLMService):
        self.llm = llm

    async def simplify(self, context: str, *, grade: int, age_years: int | None = None) -> dict:
        system = (
            "You simplify educational context for young learners. Keep facts grounded only in the provided context. "
            "Return JSON with keys: summary, vocabulary, key_points."
        )
        user = (
            f"Grade: {grade}\nAge years: {age_years or 'not specified'}\n\n"
            f"Context:\n{context}\n\n"
            "Use child-friendly language, short sentences, and no copyrighted textbook wording."
        )
        return await self.llm.complete_json(system, user)

