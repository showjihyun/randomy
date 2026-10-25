"""J008 정리 결과 저장 API 수락 테스트. 모델은 부르지 않는다."""

from collections.abc import Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.model import Completion
from randomy.settings import Settings

NOTE_FIELDS = {"id", "title", "body", "created_at"}
DECISION_FIELDS = {"id", "note_id", "text", "created_at"}
TODO_FIELDS = {"id", "note_id", "task", "owner", "due", "done", "created_at"}

PAYLOAD: dict[str, Any] = {
    "title": "주간 회의",
    "body": "주간 회의\n- 배포는 금요일에 하기로 함\n- 민수: 11월 1일까지 보고서 작성",
    "summary": "주간 회의에서 배포 일정을 정했다.",
    "decisions": ["배포는 금요일에 한다", "회의는 격주로 한다"],
    "todos": [
        {"task": "보고서 작성", "owner": "민수", "due": "11월 1일"},
        {"task": "자료 정리", "owner": None, "due": None},
    ],
}


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


def _organize(client: TestClient, **overrides: Any) -> dict[str, Any]:
    response = client.post("/api/organized", json={**PAYLOAD, **overrides})
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


def _snapshot(client: TestClient) -> tuple[Any, Any, Any]:
    notes = client.get("/api/notes")
    todos = client.get("/api/todos")
    decisions = client.get("/api/decisions")
    assert notes.status_code == 200
    assert todos.status_code == 200
    assert decisions.status_code == 200
    return notes.json(), todos.json(), decisions.json()


def test_post_organized_returns_201_with_saved_parts(
    app_client: TestClient, model: NoCallModel
) -> None:
    response = app_client.post("/api/organized", json=PAYLOAD)
    assert response.status_code == 201, response.text
    data = response.json()
    assert set(data) == {"note", "summary", "decisions", "todos"}

    note = data["note"]
    assert set(note) == NOTE_FIELDS
    assert isinstance(note["id"], int)
    assert note["title"] == PAYLOAD["title"]
    assert note["body"] == PAYLOAD["body"]
    datetime.fromisoformat(note["created_at"])

    assert data["summary"] == PAYLOAD["summary"]

    assert [d["text"] for d in data["decisions"]] == PAYLOAD["decisions"]
    for decision in data["decisions"]:
        assert set(decision) == DECISION_FIELDS
        assert isinstance(decision["id"], int)
        assert decision["note_id"] == note["id"]
        datetime.fromisoformat(decision["created_at"])

    assert [(t["task"], t["owner"], t["due"]) for t in data["todos"]] == [
        ("보고서 작성", "민수", "11월 1일"),
        ("자료 정리", None, None),
    ]
    for todo in data["todos"]:
        assert set(todo) == TODO_FIELDS
        assert isinstance(todo["id"], int)
        assert todo["note_id"] == note["id"]
        assert todo["done"] is False
        datetime.fromisoformat(todo["created_at"])

    assert model.calls == []


def test_saved_parts_show_in_list_apis(app_client: TestClient) -> None:
    data = _organize(app_client)

    notes, todos, decisions = _snapshot(app_client)
    assert notes == [data["note"]]
    assert sorted(todos, key=lambda t: t["id"]) == sorted(data["todos"], key=lambda t: t["id"])
    assert sorted(decisions, key=lambda d: d["id"]) == sorted(
        data["decisions"], key=lambda d: d["id"]
    )

    note_response = app_client.get(f"/api/notes/{data['note']['id']}")
    assert note_response.status_code == 200
    assert note_response.json() == data["note"]


def test_empty_decisions_and_todos_are_saved(app_client: TestClient) -> None:
    data = _organize(app_client, decisions=[], todos=[])
    assert data["decisions"] == []
    assert data["todos"] == []
    assert data["summary"] == PAYLOAD["summary"]

    notes, todos, decisions = _snapshot(app_client)
    assert notes == [data["note"]]
    assert todos == []
    assert decisions == []

    organized = app_client.get(f"/api/notes/{data['note']['id']}/organized")
    assert organized.status_code == 200
    assert organized.json() == {"summary": PAYLOAD["summary"], "decisions": []}


@pytest.mark.parametrize(
    "overrides",
    [
        {"body": ""},
        {"todos": [{"task": "보고서 작성", "owner": "민수", "due": None}, {"task": ""}]},
        {"todos": [{"task": "보고서 작성"}, {"owner": "민수"}]},
        {"decisions": ["배포는 금요일에 한다", 3]},
        {"todos": "보고서 작성"},
    ],
)
def test_invalid_payload_is_422_and_saves_nothing(
    app_client: TestClient, overrides: dict[str, Any]
) -> None:
    before = _organize(app_client)
    snapshot = _snapshot(app_client)

    response = app_client.post("/api/organized", json={**PAYLOAD, **overrides})
    assert response.status_code == 422

    assert _snapshot(app_client) == snapshot
    assert snapshot[0] == [before["note"]]


@pytest.mark.parametrize("missing", ["title", "body", "summary", "decisions", "todos"])
def test_missing_field_is_422_and_saves_nothing(app_client: TestClient, missing: str) -> None:
    payload = {k: v for k, v in PAYLOAD.items() if k != missing}

    response = app_client.post("/api/organized", json=payload)
    assert response.status_code == 422

    assert _snapshot(app_client) == ([], [], [])


def test_list_decisions_newest_first(app_client: TestClient) -> None:
    first = _organize(app_client, decisions=["A", "B"])
    second = _organize(app_client, decisions=["C"])

    response = app_client.get("/api/decisions")
    assert response.status_code == 200
    items = response.json()
    assert [d["text"] for d in items] == ["C", "B", "A"]
    assert [d["note_id"] for d in items] == [
        second["note"]["id"],
        first["note"]["id"],
        first["note"]["id"],
    ]
    created = [d["created_at"] for d in items]
    assert created == sorted(created, reverse=True)


def test_list_decisions_empty(app_client: TestClient) -> None:
    response = app_client.get("/api/decisions")
    assert response.status_code == 200
    assert response.json() == []


def test_get_organized_returns_summary_and_decisions(app_client: TestClient) -> None:
    first = _organize(app_client)
    second = _organize(app_client, summary="두 번째 요약", decisions=["다른 결정"])

    response = app_client.get(f"/api/notes/{first['note']['id']}/organized")
    assert response.status_code == 200
    assert response.json() == {"summary": PAYLOAD["summary"], "decisions": first["decisions"]}

    other = app_client.get(f"/api/notes/{second['note']['id']}/organized")
    assert other.status_code == 200
    assert other.json() == {"summary": "두 번째 요약", "decisions": second["decisions"]}


def test_get_organized_for_plain_note_has_no_summary(app_client: TestClient) -> None:
    created = app_client.post("/api/notes", json={"title": "메모", "body": "본문"})
    assert created.status_code == 201

    response = app_client.get(f"/api/notes/{created.json()['id']}/organized")
    assert response.status_code == 200
    assert response.json() == {"summary": None, "decisions": []}


def test_get_organized_for_missing_note_is_404(app_client: TestClient) -> None:
    _organize(app_client)

    response = app_client.get("/api/notes/999999/organized")
    assert response.status_code == 404


def test_existing_note_and_todo_apis_unchanged(app_client: TestClient) -> None:
    organized = _organize(app_client, todos=[])

    note_response = app_client.post("/api/notes", json={"title": "메모", "body": "본문"})
    assert note_response.status_code == 201
    note = note_response.json()
    assert set(note) == NOTE_FIELDS

    todo_response = app_client.post(f"/api/notes/{note['id']}/todos", json={"task": "할 일"})
    assert todo_response.status_code == 201
    todo = todo_response.json()
    assert todo["note_id"] == note["id"]

    notes, todos, _ = _snapshot(app_client)
    assert notes == [note, organized["note"]]
    assert todos == [todo]


def test_organized_persists_across_app_instances(settings: Settings) -> None:
    model = NoCallModel()
    with TestClient(create_app(settings, model=model)) as first_client:
        data = _organize(first_client)

    with TestClient(create_app(settings, model=model)) as second_client:
        notes, todos, decisions = _snapshot(second_client)
        assert notes == [data["note"]]
        assert sorted(todos, key=lambda t: t["id"]) == sorted(data["todos"], key=lambda t: t["id"])
        assert sorted(decisions, key=lambda d: d["id"]) == sorted(
            data["decisions"], key=lambda d: d["id"]
        )
        organized = second_client.get(f"/api/notes/{data['note']['id']}/organized")
        assert organized.status_code == 200
        assert organized.json() == {"summary": PAYLOAD["summary"], "decisions": data["decisions"]}

    assert model.calls == []
