# Aivorah Multi-Curriculum Knowledge Base Backend

FastAPI backend for MCP-style educational RAG across NCERT, Cambridge, Oxford, Pearson, Hodder, Singapore MOE, and Arrow references.

## Compliance stance

- Do not scrape restricted publisher textbooks directly.
- Ingest licensed, teacher-created, official-partner, open, or already processed semantic reference content.
- Store semantic chunks, metadata, and embeddings. Avoid storing raw copyrighted books as source files.
- NCERT can be ingested when using open official content. Restricted publishers should be treated as references until licensing is confirmed.

## Run locally

```bash
cd backend
cp .env.example .env
docker compose up --build
```

API docs:

- `http://localhost:8000/docs`
- `http://localhost:8000/api/v1/health`

## Main endpoints

- `POST /api/v1/ingestion`
- `POST /api/v1/retrieval/search`
- `POST /api/v1/retrieval/context`
- `POST /api/v1/worksheets/generate`
- `POST /api/v1/admin/qdrant/setup`

## Example flows

After the stack is running:

```bash
cd backend
python scripts/example_flows.py
```

## Bulk ingestion for Grades 1-5

Create JSONL files where each line is one `IngestionItem`. Use this for:

- official/open content where reuse is allowed,
- licensed publisher content after the license is signed,
- teacher-created summaries,
- topic maps,
- learning objectives,
- anonymized semantic notes.

Do not use this loader for scraped publisher textbook text before licensing is complete.

Validate a file without writing:

```bash
python scripts/bulk_ingest_jsonl.py --file data/seed/grade_1_5_semantic_references.sample.jsonl --dry-run
```

Ingest into Qdrant:

```bash
python scripts/bulk_ingest_jsonl.py --file data/seed/grade_1_5_semantic_references.sample.jsonl
```

Required metadata fields per record:

- `curriculum`: `NCERT`, `Cambridge`, `Oxford`, `Pearson`, `Hodder`, `Singapore MOE`, or `Arrow`
- `grade`: start with `1` to `5`
- `subject`
- `topic`
- `learning_objective`
- `difficulty`
- `bloom_taxonomy`
- `license_status`: use `licensed`, `official_partner`, `teacher_created`, or `processed_reference`

## Architecture notes

- `ingestion_service`: accepts JSON/text, cleans and normalizes text.
- `chunking_service`: LangChain `RecursiveCharacterTextSplitter` with `chunk_size=300`, `overlap=50`.
- `metadata_service`: adds curriculum, grade, subject, topic, learning objective, difficulty, Bloom taxonomy, and source metadata.
- `embedding_service`: OpenAI `text-embedding-3-small`.
- `qdrant_service`: collection setup, indexes, upsert, metadata-filtered vector search.
- `retrieval_service`: semantic search.
- `context_builder_service`: merges and deduplicates multi-curriculum chunks.
- `simplification_service`: child-friendly language conversion.
- `worksheet_generator_service`: MCQ, fill in blanks, matching, and short answers.
- `validation_service`: hallucination, mismatch, duplicate, and safety checks.
- `orchestration_service`: LangGraph workflow for retrieval to validated worksheet.

The service is intentionally ready for future OCR/image ingestion by keeping ingestion input schemas separate from chunking and embedding.
