"""할 일 저장·목록·완료 API (SQLite)."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


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


def _to_todo(row: sqlite3.Row) -> TodoOut:
    return TodoOut(
        id=row["id"],
        note_id=row["note_id"],
        task=row["task"],
        owner=row["owner"],
        due=row["due"],
        done=bool(row["done"]),
        created_at=row["created_at"],
    )


def create_todos_router(db_path: Path) -> APIRouter:
    _init_db(db_path)
    router = APIRouter(prefix="/api")

    @router.post("/notes/{note_id}/todos", status_code=201)
    def create_todo(note_id: int, todo: TodoIn) -> TodoOut:
        created_at = datetime.now(UTC).isoformat()
        conn = _connect(db_path)
        try:
            note = conn.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone()
            if note is None:
                raise HTTPException(status_code=404, detail="note not found")
            with conn:
                cur = conn.execute(
                    "INSERT INTO todos (note_id, task, owner, due, done, created_at) "
                    "VALUES (?, ?, ?, ?, 0, ?)",
                    (note_id, todo.task, todo.owner, todo.due, created_at),
                )
            todo_id = cur.lastrowid
        finally:
            conn.close()
        assert todo_id is not None
        return TodoOut(
            id=todo_id,
            note_id=note_id,
            task=todo.task,
            owner=todo.owner,
            due=todo.due,
            done=False,
            created_at=created_at,
        )

    @router.get("/todos")
    def list_todos(done: bool | None = None) -> list[TodoOut]:
        conn = _connect(db_path)
        try:
            if done is None:
                rows = conn.execute("SELECT * FROM todos ORDER BY done ASC, id DESC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM todos WHERE done = ? ORDER BY id DESC", (int(done),)
                ).fetchall()
        finally:
            conn.close()
        return [_to_todo(r) for r in rows]

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
            row = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        finally:
            conn.close()
        return _to_todo(row)

    return router
