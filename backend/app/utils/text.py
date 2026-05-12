import re
import unicodedata


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = re.sub(r"\r\n?", "\n", normalized)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def stable_text_hash(text: str) -> str:
    import hashlib

    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()

