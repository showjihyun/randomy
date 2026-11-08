"""캘린더 API. 노트·결정·할 일 기한을 날짜별로 모은다 (읽기 전용, 모델 호출 없음)."""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, tzinfo
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from randomy.todos import TODO_SELECT, to_todo_out

_MONTH = re.compile(r"([0-9]{4})-(0[1-9]|1[0-2])", re.ASCII)


class CalendarNote(BaseModel):
    id: int
    title: str


class CalendarDecision(BaseModel):
    text: str
    note_id: int
    note_title: str


class CalendarTodo(BaseModel):
    id: int
    task: str
    done: bool
    note_id: int
    due: str | None
    due_date: str


class CalendarDay(BaseModel):
    date: str
    notes: list[CalendarNote]
    decisions: list[CalendarDecision]
    todos: list[CalendarTodo]


class CalendarOut(BaseModel):
    month: str
    days: list[CalendarDay]


def _valid_month(month: str) -> bool:
    match = _MONTH.fullmatch(month)
    return match is not None and match.group(1) != "0000"


def calendar(db_path: Path, month: str | None, tz: tzinfo | None) -> CalendarOut:
    zone = tz if tz is not None else datetime.now().astimezone().tzinfo
    if month is None:
        month = datetime.now(zone).strftime("%Y-%m")
    if not _valid_month(month):
        raise ValueError("month must be YYYY-MM")

    def local_date(created_at: str) -> str:
        return datetime.fromisoformat(created_at).astimezone(zone).date().isoformat()

    days: dict[str, CalendarDay] = {}

    def day(key: str) -> CalendarDay:
        if key not in days:
            days[key] = CalendarDay(date=key, notes=[], decisions=[], todos=[])
        return days[key]

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        note_rows = conn.execute("SELECT id, title, created_at FROM notes ORDER BY id").fetchall()
        decision_rows = conn.execute(
            "SELECT d.text, d.note_id, n.title AS note_title, n.created_at AS note_created_at "
            "FROM decisions d JOIN notes n ON n.id = d.note_id ORDER BY d.id"
        ).fetchall()
        todo_rows = conn.execute(f"{TODO_SELECT} ORDER BY t.id").fetchall()
    finally:
        conn.close()

    for r in note_rows:
        key = local_date(r["created_at"])
        if key.startswith(month):
            day(key).notes.append(CalendarNote(id=r["id"], title=r["title"]))
    for r in decision_rows:
        key = local_date(r["note_created_at"])
        if key.startswith(month):
            day(key).decisions.append(
                CalendarDecision(text=r["text"], note_id=r["note_id"], note_title=r["note_title"])
            )
    for r in todo_rows:
        todo = to_todo_out(r, r["note_created_at"], zone)
        if todo.due_date is not None and todo.due_date.startswith(month):
            day(todo.due_date).todos.append(
                CalendarTodo(
                    id=todo.id,
                    task=todo.task,
                    done=todo.done,
                    note_id=todo.note_id,
                    due=todo.due,
                    due_date=todo.due_date,
                )
            )
    return CalendarOut(month=month, days=[days[k] for k in sorted(days)])


def create_calendar_router(db_path: Path) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/calendar")
    def get_calendar(month: str | None = None) -> CalendarOut:
        try:
            return calendar(db_path, month, None)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="month must be YYYY-MM") from error

    return router
