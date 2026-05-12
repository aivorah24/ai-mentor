from app.schemas.worksheet import WorksheetRequest
from app.services.llm_service import LLMService


class WorksheetGeneratorService:
    def __init__(self, llm: LLMService):
        self.llm = llm

    async def generate(self, request: WorksheetRequest, simplified_context: dict) -> dict:
        system = (
            "You generate original educational worksheets from supplied semantic context. "
            "Do not copy publisher wording. Return valid JSON with sections matching requested question types. "
            "Each question must include answer and rationale."
        )
        user = (
            f"Topic: {request.topic}\nGrade: {request.grade}\nSubject: {request.subject}\n"
            f"Question types: {request.question_types}\nQuestions per type: {request.questions_per_type}\n\n"
            f"Simplified context JSON:\n{simplified_context}\n\n"
            "Return JSON shape: {\"title\": str, \"instructions\": str, \"sections\": [{\"type\": str, \"questions\": [...] }]}."
        )
        return await self.llm.complete_json(system, user)

