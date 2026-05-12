from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class Curriculum(StrEnum):
    ncert = "NCERT"
    cambridge = "Cambridge"
    oxford = "Oxford"
    pearson = "Pearson"
    hodder = "Hodder"
    singapore_moe = "Singapore MOE"
    arrow = "Arrow"


class Difficulty(StrEnum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class BloomTaxonomy(StrEnum):
    remember = "remember"
    understand = "understand"
    apply = "apply"
    analyze = "analyze"
    evaluate = "evaluate"
    create = "create"


class CurriculumMetadata(BaseModel):
    curriculum: Curriculum
    grade: int = Field(ge=1, le=12)
    subject: str = Field(min_length=1, max_length=80)
    topic: str = Field(min_length=1, max_length=160)
    learning_objective: str = Field(min_length=1, max_length=500)
    difficulty: Difficulty = Difficulty.easy
    bloom_taxonomy: BloomTaxonomy = BloomTaxonomy.understand
    source_reference: str | None = Field(default=None, max_length=500)
    license_status: str = "processed_reference"
    tags: list[str] = Field(default_factory=list)

    def payload(self) -> dict[str, Any]:
        data = self.model_dump()
        data["curriculum"] = str(self.curriculum)
        data["difficulty"] = str(self.difficulty)
        data["bloom_taxonomy"] = str(self.bloom_taxonomy)
        return data

