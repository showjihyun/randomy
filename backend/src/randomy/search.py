"""검색 (SQLite LIKE). 노트(제목·원문·요약)와 결정 사항을 검색어로 찾는다."""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

SNIPPET_MAX = 120
SNIPPET_BEFORE = 40
DEFAULT_LIMIT = 20


class NoteHit(BaseModel):
    id: int
    title: str
    snippet: str
    created_at: str


class DecisionHit(BaseModel):
    id: int
    note_id: int
    note_title: str
    text: str
    created_at: str


@dataclass
class SearchResult:
    notes: list[NoteHit] = field(default_factory=list)
    decisions: list[DecisionHit] = field(default_factory=list)


def _escape(word: str) -> str:
    return word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _snippet(body: str, words: list[str]) -> str:
    if len(body) <= SNIPPET_MAX:
        return body
    best: tuple[int, int] | None = None
    for word in words:
        match = re.search(re.escape(word), body, re.IGNORECASE)
        if match is not None and (best is None or match.start() < best[0]):
            best = (match.start(), match.end())
    if best is None:
        return body[:SNIPPET_MAX]
    start = max(0, best[0] - SNIPPET_BEFORE)
    if best[1] > start + SNIPPET_MAX:
        start = best[0]
    return body[start : start + SNIPPET_MAX]


def search(db_path: Path, query: str, limit: int = DEFAULT_LIMIT) -> SearchResult:
    words = query.split()
    if not words:
        return SearchResult()
    patterns = [f"%{_escape(w)}%" for w in words]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        note_where = " AND ".join(
            "(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\' "
            "OR s.summary LIKE ? ESCAPE '\\')"
            for _ in words
        )
        note_params: list[str | int] = [p for p in patterns for _ in range(3)]
        note_rows = conn.execute(
            "SELECT n.id, n.title, n.body, n.created_at FROM notes n "
            "LEFT JOIN summaries s ON s.note_id = n.id "
            f"WHERE {note_where} ORDER BY n.created_at DESC, n.id DESC LIMIT ?",
            [*note_params, limit],
        ).fetchall()
        decision_where = " AND ".join("d.text LIKE ? ESCAPE '\\'" for _ in words)
        decision_rows = conn.execute(
            "SELECT d.id, d.note_id, n.title AS note_title, d.text, d.created_at "
            "FROM decisions d JOIN notes n ON n.id = d.note_id "
            f"WHERE {decision_where} ORDER BY d.created_at DESC, d.id DESC LIMIT ?",
            [*patterns, limit],
        ).fetchall()
    finally:
        conn.close()
    return SearchResult(
        notes=[
            NoteHit(
                id=r["id"],
                title=r["title"],
                snippet=_snippet(r["body"], words),
                created_at=r["created_at"],
            )
            for r in note_rows
        ],
        decisions=[
            DecisionHit(
                id=r["id"],
                note_id=r["note_id"],
                note_title=r["note_title"],
                text=r["text"],
                created_at=r["created_at"],
            )
            for r in decision_rows
        ],
    )


class SearchOut(BaseModel):
    notes: list[NoteHit]
    decisions: list[DecisionHit]


def create_search_router(db_path: Path) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/search")
    def search_route(q: str | None = None) -> SearchOut:
        if q is None or not q.strip():
            raise HTTPException(status_code=422, detail="q must not be blank")
        result = search(db_path, q)
        return SearchOut(notes=result.notes, decisions=result.decisions)

    return router
