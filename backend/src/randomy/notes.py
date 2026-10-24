"""노트 저장·목록 API (SQLite)."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


class NoteIn(BaseModel):
    title: str
    body: str = Field(min_length=1)


class NoteOut(BaseModel):
    id: int
    title: str
    body: str
    created_at: str


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db(db_path: Path) -> None:
    conn = _connect(db_path)
    try:
        with conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS notes ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "title TEXT NOT NULL, "
                "body TEXT NOT NULL, "
                "created_at TEXT NOT NULL)"
            )
    finally:
        conn.close()


def _to_note(row: sqlite3.Row) -> NoteOut:
    return NoteOut(id=row["id"], title=row["title"], body=row["body"], created_at=row["created_at"])


def create_notes_router(db_path: Path) -> APIRouter:
    _init_db(db_path)
    router = APIRouter(prefix="/api/notes")

    @router.post("", status_code=201)
    def create_note(note: NoteIn) -> NoteOut:
        created_at = datetime.now(UTC).isoformat()
        conn = _connect(db_path)
        try:
            with conn:
                cur = conn.execute(
                    "INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)",
                    (note.title, note.body, created_at),
                )
            note_id = cur.lastrowid
        finally:
            conn.close()
        assert note_id is not None
        return NoteOut(id=note_id, title=note.title, body=note.body, created_at=created_at)

    @router.get("")
    def list_notes() -> list[NoteOut]:
        conn = _connect(db_path)
        try:
            rows = conn.execute("SELECT * FROM notes ORDER BY id DESC").fetchall()
        finally:
            conn.close()
        return [_to_note(r) for r in rows]

    @router.get("/{note_id}")
    def get_note(note_id: int) -> NoteOut:
        conn = _connect(db_path)
        try:
            row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
        finally:
            conn.close()
        if row is None:
            raise HTTPException(status_code=404, detail="note not found")
        return _to_note(row)

    return router
