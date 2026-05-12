from app.schemas.retrieval import BuiltContextResponse, RetrievalResponse
from app.utils.text import stable_text_hash


class ContextBuilderService:
    def build(self, retrieval: RetrievalResponse, max_chars: int = 5000) -> BuiltContextResponse:
        seen: set[str] = set()
        context_parts: list[str] = []
        selected = []
        curricula = set()

        for chunk in sorted(retrieval.results, key=lambda item: item.score, reverse=True):
            digest = stable_text_hash(chunk.text[:220])
            if digest in seen:
                continue
            seen.add(digest)
            curricula.add(chunk.metadata.get("curriculum", "unknown"))
            selected.append(chunk)
            context_parts.append(
                f"[{chunk.metadata.get('curriculum')} | G{chunk.metadata.get('grade')} | "
                f"{chunk.metadata.get('subject')} | {chunk.metadata.get('topic')}]\n{chunk.text}"
            )
            if sum(len(part) for part in context_parts) >= max_chars:
                break

        return BuiltContextResponse(
            query=retrieval.query,
            context="\n\n".join(context_parts)[:max_chars],
            chunks=selected,
            curricula_covered=sorted(curricula),
        )

