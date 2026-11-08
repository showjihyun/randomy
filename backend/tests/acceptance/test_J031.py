"""J031 할 일 due_date와 캘린더 API 수락 테스트. 모델을 부르지 않는다."""

import importlib
import importlib.util
import inspect
import sqlite3
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from randomy.notes import create_notes_router
from randomy.organized import create_organized_router
from randomy.settings import Settings
from randomy.todos import TodoOut, create_todos_router
from randomy.weekly import create_weekly_router, weekly

KST = timezone(timedelta(hours=9))
# UTC+14와 UTC-12는 26시간 차이라 언제 실행해도 로컬 날짜가 서로 다르다.
EAST = timezone(timedelta(hours=14))
WEST = timezone(timedelta(hours=-12))

TODO_FIELDS = {"id", "note_id", "task", "owner", "due", "done", "created_at", "due_date"}

# UTC로는 11월 7일(토), UTC+9로는 11월 8일(일) 00:30이다.
NOV_8_KST = "2026-11-07T15:30:00+00:00"
# 서버 시간대와 관계없이 같은 날짜가 되도록 UTC 정오를 쓴다 (J011과 같은 방식).
NOV_8_NOON = "2026-11-08T12:00:00+00:00"
OCT_20_NOON = "2026-10-20T12:00:00+00:00"
# 결정·할 일 행의 created_at. 노트 작성일과 달라야 노트 기준인지 확인된다.
OTHER_TIME = "2026-12-25T12:00:00+00:00"


def _router(factory: Callable[..., APIRouter], db_path: Path, tz: tzinfo) -> APIRouter:
    assert "tz" in inspect.signature(factory).parameters, f"{factory.__name__}에 tz 인자가 없습니다"
    return factory(db_path, tz=tz)


def _client(settings: Settings, tz: tzinfo) -> TestClient:
    app = FastAPI()
    app.include_router(create_notes_router(settings.db_path))
    for factory in (create_todos_router, create_organized_router, create_weekly_router):
        app.include_router(_router(factory, settings.db_path, tz))
    return TestClient(app)


def _execute(settings: Settings, sql: str, params: tuple[Any, ...]) -> None:
    conn = sqlite3.connect(settings.db_path)
    try:
        with conn:
            conn.execute(sql, params)
    finally:
        conn.close()


def _set_note_time(settings: Settings, note_id: int, created_at: str) -> None:
    _execute(settings, "UPDATE notes SET created_at = ? WHERE id = ?", (created_at, note_id))


def _note(client: TestClient, title: str = "주간 회의") -> int:
    response = client.post("/api/notes", json={"title": title, "body": "본문"})
    assert response.status_code == 201, response.text
    note_id: int = response.json()["id"]
    return note_id


def _add_todo(client: TestClient, note_id: int, task: str, due: str | None) -> dict[str, Any]:
    response = client.post(f"/api/notes/{note_id}/todos", json={"task": task, "due": due})
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


def _todos(client: TestClient) -> dict[int, dict[str, Any]]:
    response = client.get("/api/todos")
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()
    for item in items:
        assert "due_date" in item, item
    return {item["id"]: item for item in items}


def _organized(
    client: TestClient,
    settings: Settings,
    created_at: str,
    *,
    title: str = "주간 회의",
    decisions: list[str] | None = None,
    todos: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """정리 결과를 저장하고 노트 시각을 바꾼다. 결정·할 일 행의 시각은 다른 날로 둔다."""
    response = client.post(
        "/api/organized",
        json={
            "title": title,
            "body": f"{title} 원문",
            "summary": "요약",
            "decisions": decisions or [],
            "todos": todos or [],
        },
    )
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    note_id = data["note"]["id"]
    _set_note_time(settings, note_id, created_at)
    _execute(
        settings, "UPDATE decisions SET created_at = ? WHERE note_id = ?", (OTHER_TIME, note_id)
    )
    _execute(settings, "UPDATE todos SET created_at = ? WHERE note_id = ?", (OTHER_TIME, note_id))
    return data


def _calendar(settings: Settings, month: str | None, tz: tzinfo) -> dict[str, Any]:
    assert importlib.util.find_spec("randomy.calendar_view") is not None, (
        "randomy.calendar_view 모듈이 없습니다"
    )
    module = importlib.import_module("randomy.calendar_view")
    result: dict[str, Any] = module.calendar(settings.db_path, month, tz).model_dump()
    return result


def _get_calendar(client: TestClient, month: str | None = None) -> dict[str, Any]:
    params = {"month": month} if month is not None else {}
    response = client.get("/api/calendar", params=params)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    return data


def _todo_item(todo: dict[str, Any], due_date: str, *, done: bool = False) -> dict[str, Any]:
    return {
        "id": todo["id"],
        "task": todo["task"],
        "done": done,
        "note_id": todo["note_id"],
        "due": todo["due"],
        "due_date": due_date,
    }


def _todo(task: str, due: str | None) -> dict[str, Any]:
    return {"task": task, "owner": None, "due": due}


def test_todo_out_requires_due_date() -> None:
    assert "due_date" in TodoOut.model_fields
    assert TodoOut.model_fields["due_date"].is_required()


def test_list_todos_due_date_from_note_local_date(settings: Settings) -> None:
    client = _client(settings, KST)
    _note(client, "앞선 노트")
    note_id = _note(client)
    friday = _add_todo(client, note_id, "보고서", "금요일")
    tomorrow = _add_todo(client, note_id, "자료", "내일")
    undecided = _add_todo(client, note_id, "검토", "미정")
    no_due = _add_todo(client, note_id, "공유", None)
    _set_note_time(settings, note_id, NOV_8_KST)

    items = _todos(client)

    assert items[friday["id"]]["due_date"] == "2026-11-13"
    assert items[tomorrow["id"]]["due_date"] == "2026-11-09"
    assert items[undecided["id"]]["due_date"] is None
    assert items[no_due["id"]]["due_date"] is None
    assert all(set(item) == TODO_FIELDS for item in items.values())

    conn = sqlite3.connect(settings.db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(todos)").fetchall()}
    finally:
        conn.close()
    assert "due_date" not in columns


@pytest.mark.parametrize(("tz", "expected"), [(KST, "2026-11-09"), (UTC, "2026-11-08")])
def test_due_date_base_follows_time_zone(settings: Settings, tz: tzinfo, expected: str) -> None:
    client = _client(settings, tz)
    note_id = _note(client)
    todo = _add_todo(client, note_id, "자료", "내일")
    _set_note_time(settings, note_id, NOV_8_KST)

    assert _todos(client)[todo["id"]]["due_date"] == expected


def test_due_date_base_is_note_not_todo_time(settings: Settings) -> None:
    client = _client(settings, KST)
    _note(client, "앞선 노트")
    note_id = _note(client)
    todo = _add_todo(client, note_id, "자료", "내일")
    _set_note_time(settings, note_id, NOV_8_KST)
    _execute(settings, "UPDATE todos SET created_at = ? WHERE id = ?", (OTHER_TIME, todo["id"]))

    item = _todos(client)[todo["id"]]

    assert item["due_date"] == "2026-11-09"
    assert item["created_at"] == OTHER_TIME
    assert item["id"] == todo["id"]
    assert item["note_id"] == note_id


def test_post_todo_response_has_due_date(settings: Settings) -> None:
    client = _client(settings, KST)
    note_id = _note(client)
    _set_note_time(settings, note_id, NOV_8_KST)

    todo = _add_todo(client, note_id, "자료", "내일")

    assert todo.get("due_date") == "2026-11-09"
    assert set(todo) == TODO_FIELDS
    assert _todos(client)[todo["id"]] == todo


def test_patch_response_has_same_due_date(settings: Settings) -> None:
    client = _client(settings, KST)
    note_id = _note(client)
    todo = _add_todo(client, note_id, "보고서", "금요일")
    _set_note_time(settings, note_id, NOV_8_KST)

    response = client.patch(f"/api/todos/{todo['id']}", json={"done": True})

    assert response.status_code == 200, response.text
    patched = response.json()
    assert patched.get("due_date") == "2026-11-13"
    assert patched["done"] is True
    assert set(patched) == TODO_FIELDS
    assert _todos(client)[todo["id"]] == patched


@pytest.mark.parametrize("tz", [EAST, WEST])
def test_organized_and_weekly_have_same_due_date(settings: Settings, tz: tzinfo) -> None:
    client = _client(settings, tz)

    response = client.post(
        "/api/organized",
        json={
            "title": "주간 회의",
            "body": "원문",
            "summary": "요약",
            "decisions": [],
            "todos": [_todo("보고서", "내일"), _todo("검토", "미정"), _todo("공유", "2026-11-20")],
        },
    )

    assert response.status_code == 201, response.text
    data = response.json()
    base = datetime.fromisoformat(data["note"]["created_at"]).astimezone(tz).date()
    assert [todo.get("due_date") for todo in data["todos"]] == [
        (base + timedelta(days=1)).isoformat(),
        None,
        "2026-11-20",
    ]
    assert all(set(todo) == TODO_FIELDS for todo in data["todos"])

    saved = sorted(data["todos"], key=lambda t: t["id"])
    assert sorted(_todos(client).values(), key=lambda t: t["id"]) == saved
    weekly_response = client.get("/api/weekly", params={"date": "2026-11-08"})
    assert weekly_response.status_code == 200, weekly_response.text
    assert sorted(weekly_response.json()["open_todos"], key=lambda t: t["id"]) == saved


def test_weekly_function_uses_time_zone_for_due_date(
    client: TestClient, settings: Settings
) -> None:
    note_id = _note(client)
    todo = _add_todo(client, note_id, "자료", "내일")
    _set_note_time(settings, note_id, NOV_8_KST)

    east = weekly(settings.db_path, date(2026, 11, 8), KST).model_dump()["open_todos"]
    utc = weekly(settings.db_path, date(2026, 11, 8), UTC).model_dump()["open_todos"]

    assert [(t["id"], t.get("due_date")) for t in east] == [(todo["id"], "2026-11-09")]
    assert [(t["id"], t.get("due_date")) for t in utc] == [(todo["id"], "2026-11-08")]


def test_calendar_groups_notes_and_todos_by_day(client: TestClient, settings: Settings) -> None:
    saved = _organized(
        client,
        settings,
        NOV_8_KST,
        decisions=["배포는 금요일"],
        todos=[
            _todo("보고서", "금요일"),
            _todo("자료", "내일"),
            _todo("검토", "미정"),
            _todo("다음 달 일", "12월 3일"),
        ],
    )
    note_id = saved["note"]["id"]
    friday, tomorrow = saved["todos"][0], saved["todos"][1]

    result = _calendar(settings, "2026-11", KST)

    assert result == {
        "month": "2026-11",
        "days": [
            {
                "date": "2026-11-08",
                "notes": [{"id": note_id, "title": "주간 회의"}],
                "decisions": [
                    {"text": "배포는 금요일", "note_id": note_id, "note_title": "주간 회의"}
                ],
                "todos": [],
            },
            {
                "date": "2026-11-09",
                "notes": [],
                "decisions": [],
                "todos": [_todo_item(tomorrow, "2026-11-09")],
            },
            {
                "date": "2026-11-13",
                "notes": [],
                "decisions": [],
                "todos": [_todo_item(friday, "2026-11-13")],
            },
        ],
    }


def test_calendar_time_zone_moves_items(client: TestClient, settings: Settings) -> None:
    _organized(
        client,
        settings,
        NOV_8_KST,
        decisions=["배포는 금요일"],
        todos=[_todo("자료", "내일")],
    )

    days = _calendar(settings, "2026-11", UTC)["days"]

    assert [day["date"] for day in days] == ["2026-11-07", "2026-11-08"]
    assert [d["text"] for d in days[0]["decisions"]] == ["배포는 금요일"]
    assert [t["due_date"] for t in days[1]["todos"]] == ["2026-11-08"]


def test_get_calendar_over_http(client: TestClient, settings: Settings) -> None:
    saved = _organized(
        client,
        settings,
        NOV_8_NOON,
        decisions=["배포는 금요일"],
        todos=[_todo("보고서", "2026-11-13")],
    )
    note_id = saved["note"]["id"]

    assert _get_calendar(client, "2026-11") == {
        "month": "2026-11",
        "days": [
            {
                "date": "2026-11-08",
                "notes": [{"id": note_id, "title": "주간 회의"}],
                "decisions": [
                    {"text": "배포는 금요일", "note_id": note_id, "note_title": "주간 회의"}
                ],
                "todos": [],
            },
            {
                "date": "2026-11-13",
                "notes": [],
                "decisions": [],
                "todos": [_todo_item(saved["todos"][0], "2026-11-13")],
            },
        ],
    }


def test_calendar_leaves_out_other_months(client: TestClient, settings: Settings) -> None:
    saved = _organized(
        client,
        settings,
        NOV_8_NOON,
        decisions=["11월 결정"],
        todos=[_todo("12월 일", "2026-12-03")],
    )

    december = _get_calendar(client, "2026-12")

    assert december["month"] == "2026-12"
    assert december["days"] == [
        {
            "date": "2026-12-03",
            "notes": [],
            "decisions": [],
            "todos": [_todo_item(saved["todos"][0], "2026-12-03")],
        }
    ]
    assert [day["date"] for day in _get_calendar(client, "2026-11")["days"]] == ["2026-11-08"]
    assert _get_calendar(client, "2026-10")["days"] == []


def test_calendar_includes_todo_from_note_of_earlier_month(
    client: TestClient, settings: Settings
) -> None:
    saved = _organized(client, settings, OCT_20_NOON, todos=[_todo("11월 일", "2026-11-13")])

    assert _get_calendar(client, "2026-11")["days"] == [
        {
            "date": "2026-11-13",
            "notes": [],
            "decisions": [],
            "todos": [_todo_item(saved["todos"][0], "2026-11-13")],
        }
    ]


def test_calendar_days_sorted_by_date(client: TestClient, settings: Settings) -> None:
    _organized(client, settings, "2026-11-20T12:00:00+00:00", title="나중 날짜")
    _organized(client, settings, "2026-11-05T12:00:00+00:00", title="앞선 날짜")

    days = _get_calendar(client, "2026-11")["days"]

    assert [day["date"] for day in days] == ["2026-11-05", "2026-11-20"]


def test_calendar_same_day_items_in_id_order(client: TestClient, settings: Settings) -> None:
    first = _organized(
        client,
        settings,
        NOV_8_NOON,
        title="첫 회의",
        decisions=["결정 A", "결정 B"],
        todos=[_todo("할 일 A", "2026-11-08")],
    )
    second = _organized(
        client,
        settings,
        NOV_8_NOON,
        title="둘째 회의",
        decisions=["결정 C"],
        todos=[_todo("할 일 B", "2026-11-08")],
    )
    first_id, second_id = first["note"]["id"], second["note"]["id"]

    assert _get_calendar(client, "2026-11")["days"] == [
        {
            "date": "2026-11-08",
            "notes": [
                {"id": first_id, "title": "첫 회의"},
                {"id": second_id, "title": "둘째 회의"},
            ],
            "decisions": [
                {"text": "결정 A", "note_id": first_id, "note_title": "첫 회의"},
                {"text": "결정 B", "note_id": first_id, "note_title": "첫 회의"},
                {"text": "결정 C", "note_id": second_id, "note_title": "둘째 회의"},
            ],
            "todos": [
                _todo_item(first["todos"][0], "2026-11-08"),
                _todo_item(second["todos"][0], "2026-11-08"),
            ],
        }
    ]


def test_calendar_includes_done_todo(client: TestClient, settings: Settings) -> None:
    saved = _organized(client, settings, NOV_8_NOON, todos=[_todo("끝낸 일", "2026-11-13")])
    patched = client.patch(f"/api/todos/{saved['todos'][0]['id']}", json={"done": True})
    assert patched.status_code == 200, patched.text

    days = _get_calendar(client, "2026-11")["days"]

    assert [t["done"] for day in days for t in day["todos"]] == [True]


@pytest.mark.parametrize(
    ("month", "inside", "outside"),
    [
        ("2026-11", ["2026-11-01", "2026-11-30"], ["2026-10-31", "2026-12-01"]),
        ("2026-12", ["2026-12-01", "2026-12-31"], ["2026-11-30", "2027-01-01"]),
        ("2028-02", ["2028-02-01", "2028-02-29"], ["2028-01-31", "2028-03-01"]),
    ],
)
def test_calendar_month_boundaries(
    client: TestClient,
    settings: Settings,
    month: str,
    inside: list[str],
    outside: list[str],
) -> None:
    _organized(client, settings, OCT_20_NOON, todos=[_todo(d, d) for d in [*inside, *outside]])

    days = _get_calendar(client, month)["days"]

    assert [day["date"] for day in days] == inside


def test_calendar_with_no_items_has_no_days(client: TestClient) -> None:
    assert _get_calendar(client, "2026-11") == {"month": "2026-11", "days": []}


def test_calendar_last_possible_month_is_valid(client: TestClient) -> None:
    assert _get_calendar(client, "9999-12") == {"month": "9999-12", "days": []}


@pytest.mark.parametrize(
    "month",
    [
        "2026-13",
        "2026-00",
        "2026-1",
        "202611",
        "2026/11",
        "2026-11-01",
        "abc",
        "",
        "0000-11",
        "２０２６-１１",
    ],
)
def test_calendar_invalid_month_is_422(client: TestClient, month: str) -> None:
    response = client.get("/api/calendar", params={"month": month})

    assert response.status_code == 422, response.text


def test_calendar_without_month_uses_this_month(client: TestClient, settings: Settings) -> None:
    assert _get_calendar(client)["month"] == date.today().strftime("%Y-%m")
    assert _calendar(settings, None, EAST)["month"] == datetime.now(EAST).strftime("%Y-%m")
