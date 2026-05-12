from langchain_text_splitters import RecursiveCharacterTextSplitter


class ChunkingService:
    def __init__(self, chunk_size: int = 300, chunk_overlap: int = 50):
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""],
        )

    def split(self, text: str) -> list[str]:
        return [chunk.strip() for chunk in self.splitter.split_text(text) if chunk.strip()]

