"""주간 정리 API. 저장된 데이터를 읽어 한 주 단위로 모은다 (읽기 전용, 모델 호출 없음)."""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from randomy.todos import TodoOut


class WeeklyNote(BaseModel):
    id: int
    title: str
    summary: str | None
    created_at: str


class WeeklyDecision(BaseModel):
    id: int
    note_id: int
    note_title: str
    text: str
    created_at: str


class WeeklyOut(BaseModel):
    start: str
    end: str
    notes: list[WeeklyNote]
    decisions: list[WeeklyDecision]
    open_todos: list[TodoOut]


def week_range(day: date) -> tuple[date, date]:
    """그 날짜가 속한 주의 월요일과 일요일."""
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


def weekly(db_path: Path, day: date) -> WeeklyOut:
    start, end = week_range(day)
    s, e = start.isoformat(), end.isoformat()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        note_rows = conn.execute(
            "SELECT n.id, n.title, s.summary, n.created_at FROM notes n "
            "LEFT JOIN summaries s ON s.note_id = n.id "
            "WHERE substr(n.created_at, 1, 10) BETWEEN ? AND ? "
            "ORDER BY n.created_at, n.id",
            (s, e),
        ).fetchall()
        decision_rows = conn.execute(
            "SELECT d.id, d.note_id, n.title AS note_title, d.text, d.created_at "
            "FROM decisions d JOIN notes n ON n.id = d.note_id "
            "WHERE substr(d.created_at, 1, 10) BETWEEN ? AND ? "
            "ORDER BY d.created_at, d.id",
            (s, e),
        ).fetchall()
        todo_rows = conn.execute(
            "SELECT * FROM todos WHERE done = 0 ORDER BY due IS NULL, due, created_at, id"
        ).fetchall()
    finally:
        conn.close()
    return WeeklyOut(
        start=s,
        end=e,
        notes=[
            WeeklyNote(
                id=r["id"], title=r["title"], summary=r["summary"], created_at=r["created_at"]
            )
            for r in note_rows
        ],
        decisions=[
            WeeklyDecision(
                id=r["id"],
                note_id=r["note_id"],
                note_title=r["note_title"],
                text=r["text"],
                created_at=r["created_at"],
            )
            for r in decision_rows
        ],
        open_todos=[
            TodoOut(
                id=r["id"],
                note_id=r["note_id"],
                task=r["task"],
                owner=r["owner"],
                due=r["due"],
                done=bool(r["done"]),
                created_at=r["created_at"],
            )
            for r in todo_rows
        ],
    )


def _parse_day(value: str) -> date:
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="date must be a real date") from error


def create_weekly_router(db_path: Path) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/weekly")
    def get_weekly(date: str | None = None) -> WeeklyOut:
        day = _parse_day(date) if date is not None else _today()
        return weekly(db_path, day)

    return router


def _today() -> date:
    return date.today()
