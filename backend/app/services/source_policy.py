from app.schemas.common import Curriculum
from app.utils.errors import AppError


ALLOWED_CURRICULA = {item.value for item in Curriculum}
OPEN_REFERENCE_CURRICULA = {"NCERT"}
RESTRICTED_REFERENCE_CURRICULA = {
    "Cambridge",
    "Oxford",
    "Pearson",
    "Hodder",
    "Singapore MOE",
    "Arrow",
}


def validate_ingestion_policy(curriculum: str, license_status: str) -> None:
    if curriculum not in ALLOWED_CURRICULA:
        raise AppError(f"Unsupported curriculum: {curriculum}", code="unsupported_curriculum")
    if curriculum in RESTRICTED_REFERENCE_CURRICULA and license_status not in {
        "licensed",
        "processed_reference",
        "teacher_created",
        "official_partner",
    }:
        raise AppError(
            "Restricted publisher content must be licensed, teacher-created, or processed semantic reference only.",
            status_code=422,
            code="restricted_source_policy",
        )

