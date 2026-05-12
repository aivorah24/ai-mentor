from collections import Counter

from app.schemas.worksheet import ValidationIssue
from app.services.llm_service import LLMService


class ValidationService:
    def __init__(self, llm: LLMService):
        self.llm = llm

    async def validate(self, worksheet: dict, context: str, source_metadata: list[dict]) -> list[ValidationIssue]:
        issues = self._duplicate_question_issues(worksheet)
        system = (
            "You validate educational worksheet JSON. Check hallucinations, curriculum mismatch, unsafe output, "
            "and age-inappropriate wording. Return JSON: {\"issues\": [{\"severity\":\"low|medium|high\", "
            "\"code\": str, \"message\": str}]}"
        )
        user = f"Context:\n{context}\n\nSource metadata:\n{source_metadata}\n\nWorksheet:\n{worksheet}"
        result = await self.llm.complete_json(system, user)
        for item in result.get("issues", []):
            issues.append(ValidationIssue(**item))
        return issues

    def _duplicate_question_issues(self, worksheet: dict) -> list[ValidationIssue]:
        questions: list[str] = []
        for section in worksheet.get("sections", []):
            for question in section.get("questions", []):
                text = str(question.get("question") or question.get("prompt") or "").lower().strip()
                if text:
                    questions.append(text)
        duplicates = [text for text, count in Counter(questions).items() if count > 1]
        return [
            ValidationIssue(severity="medium", code="duplicate_question", message=f"Duplicate question: {text[:120]}")
            for text in duplicates
        ]

