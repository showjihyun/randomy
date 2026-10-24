"""API 앱."""

from __future__ import annotations

from fastapi import FastAPI

from randomy.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Randomy")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "model": settings.model}

    return app


def app_from_env() -> FastAPI:
    return create_app(Settings.from_env())
