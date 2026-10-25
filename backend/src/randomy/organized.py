"""정리 결과 저장 API (SQLite). 노트·요약·결정 사항·할 일을 한 번에 저장한다."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from randomy.notes import NoteOut
from randomy.todos import TodoIn, TodoOut


class OrganizedIn(BaseModel):
    title: str
    body: str = Field(min_length=1)
    summary: str
    decisions: list[str]
    todos: list[TodoIn]


class DecisionOut(BaseModel):
    id: int
    note_id: int
    text: str
    created_at: str


class OrganizedOut(BaseModel):
    note: NoteOut
    summary: str
    decisions: list[DecisionOut]
    todos: list[TodoOut]


class NoteOrganizedOut(BaseModel):
    summary: str | None
    decisions: list[DecisionOut]


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
                "CREATE TABLE IF NOT EXISTS summaries ("
                "note_id INTEGER PRIMARY KEY, "
                "summary TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS decisions ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "note_id INTEGER NOT NULL, "
                "text TEXT NOT NULL, "
                "created_at TEXT NOT NULL)"
            )
    finally:
        conn.close()


def _to_decision(row: sqlite3.Row) -> DecisionOut:
    return DecisionOut(
        id=row["id"], note_id=row["note_id"], text=row["text"], created_at=row["created_at"]
    )


def create_organized_router(db_path: Path) -> APIRouter:
    _init_db(db_path)
    router = APIRouter(prefix="/api")

    @router.post("/organized", status_code=201)
    def save_organized(data: OrganizedIn) -> OrganizedOut:
        created_at = datetime.now(UTC).isoformat()
        decisions: list[DecisionOut] = []
        todos: list[TodoOut] = []
        conn = _connect(db_path)
        try:
            with conn:
                cur = conn.execute(
                    "INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)",
                    (data.title, data.body, created_at),
                )
                note_id = cur.lastrowid
                assert note_id is not None
                conn.execute(
                    "INSERT INTO summaries (note_id, summary) VALUES (?, ?)",
                    (note_id, data.summary),
                )
                for text in data.decisions:
                    cur = conn.execute(
                        "INSERT INTO decisions (note_id, text, created_at) VALUES (?, ?, ?)",
                        (note_id, text, created_at),
                    )
                    assert cur.lastrowid is not None
                    decisions.append(
                        DecisionOut(
                            id=cur.lastrowid, note_id=note_id, text=text, created_at=created_at
                        )
                    )
                for todo in data.todos:
                    cur = conn.execute(
                        "INSERT INTO todos (note_id, task, owner, due, done, created_at) "
                        "VALUES (?, ?, ?, ?, 0, ?)",
                        (note_id, todo.task, todo.owner, todo.due, created_at),
                    )
                    assert cur.lastrowid is not None
                    todos.append(
                        TodoOut(
                            id=cur.lastrowid,
                            note_id=note_id,
                            task=todo.task,
                            owner=todo.owner,
                            due=todo.due,
                            done=False,
                            created_at=created_at,
                        )
                    )
        finally:
            conn.close()
        return OrganizedOut(
            note=NoteOut(id=note_id, title=data.title, body=data.body, created_at=created_at),
            summary=data.summary,
            decisions=decisions,
            todos=todos,
        )

    @router.get("/decisions")
    def list_decisions() -> list[DecisionOut]:
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                "SELECT * FROM decisions ORDER BY created_at DESC, id DESC"
            ).fetchall()
        finally:
            conn.close()
        return [_to_decision(r) for r in rows]

    @router.get("/notes/{note_id}/organized")
    def get_organized(note_id: int) -> NoteOrganizedOut:
        conn = _connect(db_path)
        try:
            note = conn.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone()
            if note is None:
                raise HTTPException(status_code=404, detail="note not found")
            summary_row = conn.execute(
                "SELECT summary FROM summaries WHERE note_id = ?", (note_id,)
            ).fetchone()
            rows = conn.execute(
                "SELECT * FROM decisions WHERE note_id = ? ORDER BY id ASC", (note_id,)
            ).fetchall()
        finally:
            conn.close()
        return NoteOrganizedOut(
            summary=summary_row["summary"] if summary_row is not None else None,
            decisions=[_to_decision(r) for r in rows],
        )

    return router
