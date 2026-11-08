"""할 일 저장·목록·완료 API (SQLite)."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, tzinfo
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from randomy.due_dates import parse_due


class TodoIn(BaseModel):
    task: str = Field(min_length=1)
    owner: str | None = None
    due: str | None = None


class TodoDone(BaseModel):
    done: bool


class TodoOut(BaseModel):
    id: int
    note_id: int
    task: str
    owner: str | None
    due: str | None
    done: bool
    created_at: str
    due_date: str | None


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
                "CREATE TABLE IF NOT EXISTS todos ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "note_id INTEGER NOT NULL, "
                "task TEXT NOT NULL, "
                "owner TEXT, "
                "due TEXT, "
                "done INTEGER NOT NULL DEFAULT 0, "
                "created_at TEXT NOT NULL)"
            )
    finally:
        conn.close()


def to_todo_out(row: sqlite3.Row, note_created_at: str, tz: tzinfo | None) -> TodoOut:
    """할 일 행을 응답으로 바꾼다. due_date의 기준일은 노트 작성일(tz 로컬)이다."""
    zone = tz if tz is not None else datetime.now().astimezone().tzinfo
    base = datetime.fromisoformat(note_created_at).astimezone(zone).date()
    parsed = parse_due(row["due"], base)
    return TodoOut(
        id=row["id"],
        note_id=row["note_id"],
        task=row["task"],
        owner=row["owner"],
        due=row["due"],
        done=bool(row["done"]),
        created_at=row["created_at"],
        due_date=parsed.isoformat() if parsed is not None else None,
    )


TODO_SELECT = (
    "SELECT t.id, t.note_id, t.task, t.owner, t.due, t.done, t.created_at, "
    "n.created_at AS note_created_at FROM todos t JOIN notes n ON n.id = t.note_id"
)


def create_todos_router(db_path: Path, tz: tzinfo | None = None) -> APIRouter:
    _init_db(db_path)
    router = APIRouter(prefix="/api")

    @router.post("/notes/{note_id}/todos", status_code=201)
    def create_todo(note_id: int, todo: TodoIn) -> TodoOut:
        created_at = datetime.now(UTC).isoformat()
        conn = _connect(db_path)
        try:
            note = conn.execute(
                "SELECT id, created_at FROM notes WHERE id = ?", (note_id,)
            ).fetchone()
            if note is None:
                raise HTTPException(status_code=404, detail="note not found")
            with conn:
                cur = conn.execute(
                    "INSERT INTO todos (note_id, task, owner, due, done, created_at) "
                    "VALUES (?, ?, ?, ?, 0, ?)",
                    (note_id, todo.task, todo.owner, todo.due, created_at),
                )
            todo_id = cur.lastrowid
            assert todo_id is not None
            row = conn.execute(f"{TODO_SELECT} WHERE t.id = ?", (todo_id,)).fetchone()
        finally:
            conn.close()
        return to_todo_out(row, row["note_created_at"], tz)

    @router.get("/todos")
    def list_todos(done: bool | None = None) -> list[TodoOut]:
        conn = _connect(db_path)
        try:
            if done is None:
                rows = conn.execute(f"{TODO_SELECT} ORDER BY t.done ASC, t.id DESC").fetchall()
            else:
                rows = conn.execute(
                    f"{TODO_SELECT} WHERE t.done = ? ORDER BY t.id DESC", (int(done),)
                ).fetchall()
        finally:
            conn.close()
        return [to_todo_out(r, r["note_created_at"], tz) for r in rows]

    @router.patch("/todos/{todo_id}")
    def update_todo(todo_id: int, body: TodoDone) -> TodoOut:
        conn = _connect(db_path)
        try:
            with conn:
                cur = conn.execute(
                    "UPDATE todos SET done = ? WHERE id = ?", (int(body.done), todo_id)
                )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="todo not found")
            row = conn.execute(f"{TODO_SELECT} WHERE t.id = ?", (todo_id,)).fetchone()
        finally:
            conn.close()
        return to_todo_out(row, row["note_created_at"], tz)

    return router
