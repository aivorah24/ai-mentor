from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.schemas.retrieval import RetrievalRequest
from app.schemas.worksheet import WorksheetRequest, WorksheetResponse
from app.services.context_builder_service import ContextBuilderService
from app.services.retrieval_service import RetrievalService
from app.services.simplification_service import SimplificationService
from app.services.validation_service import ValidationService
from app.services.worksheet_generator_service import WorksheetGeneratorService


class WorksheetState(TypedDict, total=False):
    request: WorksheetRequest
    retrieval: Any
    built_context: Any
    simplified: dict
    worksheet: dict
    issues: list


class OrchestrationService:
    def __init__(
        self,
        retrieval: RetrievalService,
        context_builder: ContextBuilderService,
        simplifier: SimplificationService,
        worksheet_generator: WorksheetGeneratorService,
        validator: ValidationService,
    ):
        self.retrieval = retrieval
        self.context_builder = context_builder
        self.simplifier = simplifier
        self.worksheet_generator = worksheet_generator
        self.validator = validator
        self.graph = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(WorksheetState)
        graph.add_node("retrieve", self._retrieve)
        graph.add_node("build_context", self._build_context)
        graph.add_node("simplify", self._simplify)
        graph.add_node("generate", self._generate)
        graph.add_node("validate", self._validate)
        graph.set_entry_point("retrieve")
        graph.add_edge("retrieve", "build_context")
        graph.add_edge("build_context", "simplify")
        graph.add_edge("simplify", "generate")
        graph.add_edge("generate", "validate")
        graph.add_edge("validate", END)
        return graph.compile()

    async def generate_worksheet(self, request: WorksheetRequest) -> WorksheetResponse:
        state = await self.graph.ainvoke({"request": request})
        built_context = state["built_context"]
        source_metadata = [chunk.metadata for chunk in built_context.chunks]
        return WorksheetResponse(
            topic=request.topic,
            grade=request.grade,
            subject=request.subject,
            context_summary=state["simplified"].get("summary", ""),
            worksheet=state["worksheet"],
            validation_issues=state["issues"],
            source_metadata=source_metadata,
        )

    async def _retrieve(self, state: WorksheetState) -> WorksheetState:
        request = state["request"]
        filters = request.filters
        filters.grade = request.grade
        filters.subject = request.subject
        retrieval_request = RetrievalRequest(query=request.topic, filters=filters, limit=12)
        state["retrieval"] = await self.retrieval.retrieve(retrieval_request)
        return state

    async def _build_context(self, state: WorksheetState) -> WorksheetState:
        state["built_context"] = self.context_builder.build(state["retrieval"])
        return state

    async def _simplify(self, state: WorksheetState) -> WorksheetState:
        request = state["request"]
        state["simplified"] = await self.simplifier.simplify(
            state["built_context"].context,
            grade=request.grade,
            age_years=request.age_years,
        )
        return state

    async def _generate(self, state: WorksheetState) -> WorksheetState:
        state["worksheet"] = await self.worksheet_generator.generate(state["request"], state["simplified"])
        return state

    async def _validate(self, state: WorksheetState) -> WorksheetState:
        state["issues"] = await self.validator.validate(
            state["worksheet"],
            state["built_context"].context,
            [chunk.metadata for chunk in state["built_context"].chunks],
        )
        return state

