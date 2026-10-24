"""API 앱."""

from __future__ import annotations

from fastapi import FastAPI

from randomy.notes import create_notes_router
from randomy.settings import Settings
from randomy.todos import create_todos_router


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Randomy")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "model": settings.model}

    app.include_router(create_notes_router(settings.db_path))
    app.include_router(create_todos_router(settings.db_path))

    return app


def app_from_env() -> FastAPI:
    return create_app(Settings.from_env())
