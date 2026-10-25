"""J011 주간 정리 API 수락 테스트. 모델은 부르지 않는다."""

import sqlite3
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.model import Completion
from randomy.settings import Settings

WEEKLY_FIELDS = {"start", "end", "notes", "decisions", "open_todos"}
NOTE_FIELDS = {"id", "title", "summary", "created_at"}
DECISION_FIELDS = {"id", "note_id", "note_title", "text", "created_at"}
TODO_FIELDS = {"id", "note_id", "task", "owner", "due", "done", "created_at"}

# 2026-10-19(월) ~ 2026-10-25(일) 주
MONDAY = "2026-10-19T00:00:00+00:00"
WEDNESDAY = "2026-10-21T09:30:00+00:00"
SUNDAY = "2026-10-25T23:59:59+00:00"
LAST_WEEK = "2026-10-14T10:00:00+00:00"
LAST_SUNDAY = "2026-10-18T23:59:59+00:00"
NEXT_MONDAY = "2026-10-26T00:00:00+00:00"


class NoCallModel:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, prompt: str) -> Completion:
        self.calls.append((system, prompt))
        raise AssertionError("모델을 부르면 안 됩니다")


@pytest.fixture
def model() -> NoCallModel:
    return NoCallModel()


@pytest.fixture
def app_client(settings: Settings, model: NoCallModel) -> Iterator[TestClient]:
    with TestClient(create_app(settings, model=model)) as test_client:
        yield test_client


def _organize(
    client: TestClient,
    settings: Settings,
    created_at: str,
    *,
    title: str,
    summary: str = "요약",
    decisions: list[str] | None = None,
    todos: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """정리 결과를 저장한 뒤 노트·결정·할 일의 created_at을 지정한 시각으로 바꾼다."""
    response = client.post(
        "/api/organized",
        json={
            "title": title,
            "body": f"{title} 원문",
            "summary": summary,
            "decisions": decisions or [],
            "todos": todos or [],
        },
    )
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    note_id = data["note"]["id"]
    conn = sqlite3.connect(settings.db_path)
    try:
        with conn:
            conn.execute("UPDATE notes SET created_at = ? WHERE id = ?", (created_at, note_id))
            conn.execute(
                "UPDATE decisions SET created_at = ? WHERE note_id = ?", (created_at, note_id)
            )
            conn.execute("UPDATE todos SET created_at = ? WHERE note_id = ?", (created_at, note_id))
    finally:
        conn.close()
    data["note"]["created_at"] = created_at
    for item in data["decisions"] + data["todos"]:
        item["created_at"] = created_at
    return data


def _weekly(client: TestClient, day: str | None = None) -> dict[str, Any]:
    params = {"date": day} if day is not None else {}
    response = client.get("/api/weekly", params=params)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    assert set(data) == WEEKLY_FIELDS
    return data


def test_wednesday_gives_monday_to_sunday(app_client: TestClient, model: NoCallModel) -> None:
    data = _weekly(app_client, "2026-10-21")
    assert data["start"] == "2026-10-19"
    assert data["end"] == "2026-10-25"
    assert model.calls == []


@pytest.mark.parametrize("day", ["2026-10-19", "2026-10-25"])
def test_monday_and_sunday_belong_to_same_week(app_client: TestClient, day: str) -> None:
    data = _weekly(app_client, day)
    assert (data["start"], data["end"]) == ("2026-10-19", "2026-10-25")


def test_week_across_year_boundary(app_client: TestClient) -> None:
    data = _weekly(app_client, "2027-01-01")
    assert (data["start"], data["end"]) == ("2026-12-28", "2027-01-03")


def test_empty_store_gives_empty_lists(app_client: TestClient, model: NoCallModel) -> None:
    data = _weekly(app_client, "2026-10-21")
    assert data["notes"] == []
    assert data["decisions"] == []
    assert data["open_todos"] == []
    assert model.calls == []


def test_missing_date_uses_today(app_client: TestClient) -> None:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    data = _weekly(app_client)
    assert data["start"] == monday.isoformat()
    assert data["end"] == (monday + timedelta(days=6)).isoformat()


@pytest.mark.parametrize("day", ["2026-13-01", "2026-02-30", "20261021", "2026/10/21", "abc", ""])
def test_invalid_date_is_422(app_client: TestClient, day: str) -> None:
    response = app_client.get("/api/weekly", params={"date": day})
    assert response.status_code == 422


def test_only_this_weeks_notes_and_decisions(
    app_client: TestClient, settings: Settings, model: NoCallModel
) -> None:
    old = _organize(app_client, settings, LAST_WEEK, title="지난주 회의", decisions=["지난주 결정"])
    _organize(app_client, settings, LAST_SUNDAY, title="지난 일요일", decisions=["일요일 결정"])
    first = _organize(
        app_client,
        settings,
        MONDAY,
        title="월요일 회의",
        summary="월요일 요약",
        decisions=["배포는 금요일", "회의는 격주"],
    )
    second = _organize(
        app_client,
        settings,
        SUNDAY,
        title="일요일 정리",
        summary="일요일 요약",
        decisions=["다음 주 계획 확정"],
    )
    _organize(app_client, settings, NEXT_MONDAY, title="다음 주", decisions=["다음 주 결정"])

    data = _weekly(app_client, "2026-10-21")

    for note in data["notes"]:
        assert set(note) == NOTE_FIELDS
    assert sorted(data["notes"], key=lambda n: n["id"]) == [
        {
            "id": first["note"]["id"],
            "title": "월요일 회의",
            "summary": "월요일 요약",
            "created_at": MONDAY,
        },
        {
            "id": second["note"]["id"],
            "title": "일요일 정리",
            "summary": "일요일 요약",
            "created_at": SUNDAY,
        },
    ]

    for decision in data["decisions"]:
        assert set(decision) == DECISION_FIELDS
    expected_decisions = [{**d, "note_title": "월요일 회의"} for d in first["decisions"]] + [
        {**d, "note_title": "일요일 정리"} for d in second["decisions"]
    ]
    assert sorted(data["decisions"], key=lambda d: d["id"]) == expected_decisions

    returned_note_ids = {n["id"] for n in data["notes"]}
    assert old["note"]["id"] not in returned_note_ids
    assert model.calls == []


def test_last_week_query_gets_last_week_items(app_client: TestClient, settings: Settings) -> None:
    old = _organize(app_client, settings, LAST_WEEK, title="지난주 회의", decisions=["지난주 결정"])
    _organize(app_client, settings, WEDNESDAY, title="이번 주 회의", decisions=["이번 주 결정"])

    data = _weekly(app_client, "2026-10-14")
    assert (data["start"], data["end"]) == ("2026-10-12", "2026-10-18")
    assert [n["id"] for n in data["notes"]] == [old["note"]["id"]]
    assert [d["text"] for d in data["decisions"]] == ["지난주 결정"]


def test_plain_note_has_null_summary(app_client: TestClient, settings: Settings) -> None:
    created = app_client.post("/api/notes", json={"title": "메모", "body": "본문"})
    assert created.status_code == 201
    note = created.json()
    conn = sqlite3.connect(settings.db_path)
    try:
        with conn:
            conn.execute("UPDATE notes SET created_at = ? WHERE id = ?", (WEDNESDAY, note["id"]))
    finally:
        conn.close()

    data = _weekly(app_client, "2026-10-21")
    assert data["notes"] == [
        {"id": note["id"], "title": "메모", "summary": None, "created_at": WEDNESDAY}
    ]
    assert data["decisions"] == []


def test_open_todos_exclude_done_and_include_older(
    app_client: TestClient, settings: Settings
) -> None:
    old = _organize(
        app_client,
        settings,
        LAST_WEEK,
        title="지난주 회의",
        todos=[{"task": "지난주 미완료", "owner": "민수", "due": None}],
    )
    current = _organize(
        app_client,
        settings,
        WEDNESDAY,
        title="이번 주 회의",
        todos=[
            {"task": "끝낸 일", "owner": None, "due": "2026-10-20"},
            {"task": "남은 일", "owner": "지수", "due": "2026-10-30"},
        ],
    )
    done_id = current["todos"][0]["id"]
    patched = app_client.patch(f"/api/todos/{done_id}", json={"done": True})
    assert patched.status_code == 200

    data = _weekly(app_client, "2026-10-21")
    for todo in data["open_todos"]:
        assert set(todo) == TODO_FIELDS
        assert todo["done"] is False
    ids = [t["id"] for t in data["open_todos"]]
    assert done_id not in ids
    assert sorted(ids) == sorted([old["todos"][0]["id"], current["todos"][1]["id"]])
    by_id = {t["id"]: t for t in data["open_todos"]}
    assert by_id[old["todos"][0]["id"]] == old["todos"][0]
    assert by_id[current["todos"][1]["id"]] == current["todos"][1]


def test_open_todos_with_due_first_in_due_order(app_client: TestClient, settings: Settings) -> None:
    data_old = _organize(
        app_client,
        settings,
        LAST_WEEK,
        title="지난주 회의",
        todos=[
            {"task": "기한 없음 A", "owner": None, "due": None},
            {"task": "11월 5일", "owner": None, "due": "2026-11-05"},
        ],
    )
    data_new = _organize(
        app_client,
        settings,
        WEDNESDAY,
        title="이번 주 회의",
        todos=[
            {"task": "기한 없음 B", "owner": None, "due": None},
            {"task": "10월 22일", "owner": None, "due": "2026-10-22"},
            {"task": "10월 30일", "owner": None, "due": "2026-10-30"},
        ],
    )
    assert len(data_old["todos"]) + len(data_new["todos"]) == 5

    data = _weekly(app_client, "2026-10-21")
    assert [t["task"] for t in data["open_todos"]] == [
        "10월 22일",
        "10월 30일",
        "11월 5일",
        "기한 없음 A",
        "기한 없음 B",
    ]


def test_weekly_does_not_change_stored_data(app_client: TestClient, settings: Settings) -> None:
    _organize(
        app_client,
        settings,
        WEDNESDAY,
        title="이번 주 회의",
        decisions=["결정"],
        todos=[{"task": "할 일", "owner": None, "due": None}],
    )
    before = (
        app_client.get("/api/notes").json(),
        app_client.get("/api/todos").json(),
        app_client.get("/api/decisions").json(),
    )
    _weekly(app_client, "2026-10-21")
    after = (
        app_client.get("/api/notes").json(),
        app_client.get("/api/todos").json(),
        app_client.get("/api/decisions").json(),
    )
    assert after == before
