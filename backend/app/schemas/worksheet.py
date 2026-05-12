from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.retrieval import RetrievalFilters

QuestionType = Literal["mcq", "fill_in_blanks", "match_the_following", "short_answer"]


class WorksheetRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=160)
    grade: int = Field(ge=1, le=12)
    subject: str = Field(min_length=1, max_length=80)
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    question_types: list[QuestionType] = Field(
        default_factory=lambda: ["mcq", "fill_in_blanks", "match_the_following", "short_answer"]
    )
    questions_per_type: int = Field(default=3, ge=1, le=10)
    age_years: int | None = Field(default=None, ge=5, le=18)


class ValidationIssue(BaseModel):
    severity: Literal["low", "medium", "high"]
    code: str
    message: str


class WorksheetResponse(BaseModel):
    topic: str
    grade: int
    subject: str
    context_summary: str
    worksheet: dict
    validation_issues: list[ValidationIssue]
    source_metadata: list[dict]

