"""API 앱."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from randomy.ask import create_ask_router
from randomy.model import Model, ModelError, get_model
from randomy.notes import create_notes_router
from randomy.notes_result import ResultError, parse_result
from randomy.organized import create_organized_router
from randomy.search import create_search_router
from randomy.settings import Settings
from randomy.todos import create_todos_router
from randomy.weekly import create_weekly_router

SKILL_PATH = Path(__file__).resolve().parents[3] / "skills" / "meeting-notes" / "SKILL.md"


class OrganizeRequest(BaseModel):
    text: str = Field(min_length=1)


def create_app(settings: Settings, model: Model | None = None) -> FastAPI:
    app = FastAPI(title="Randomy")

    @app.post("/api/organize")
    def organize(request: OrganizeRequest) -> dict[str, Any]:
        active = model if model is not None else get_model(settings)
        system = SKILL_PATH.read_text(encoding="utf-8")
        try:
            completion = active.complete(system, request.text)
        except ModelError as error:
            raise HTTPException(
                status_code=502,
                detail={"message": f"모델 호출 실패: {error}", "problems": [str(error)]},
            ) from error
        try:
            return parse_result(completion.text)
        except ResultError as error:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "모델 출력이 형식에 맞지 않습니다",
                    "problems": error.problems,
                },
            ) from error

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "model": settings.model}

    app.include_router(create_notes_router(settings.db_path))
    app.include_router(create_todos_router(settings.db_path))
    app.include_router(create_organized_router(settings.db_path))
    app.include_router(create_search_router(settings.db_path))
    app.include_router(create_weekly_router(settings.db_path))
    app.include_router(
        create_ask_router(
            settings.db_path, lambda: model if model is not None else get_model(settings)
        )
    )

    return app


def app_from_env() -> FastAPI:
    return create_app(Settings.from_env())
