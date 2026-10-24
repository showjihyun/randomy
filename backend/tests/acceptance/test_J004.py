"""J004 할 일 저장·목록·완료 API 수락 테스트."""

from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.settings import Settings

TODO_FIELDS = {"id", "note_id", "task", "owner", "due", "done", "created_at"}


def _note(client: TestClient, title: str = "회의") -> dict[str, Any]:
    response = client.post("/api/notes", json={"title": title, "body": "본문"})
    assert response.status_code == 201
    data: dict[str, Any] = response.json()
    return data


def _todo(client: TestClient, note_id: int, task: str, **extra: object) -> dict[str, Any]:
    response = client.post(f"/api/notes/{note_id}/todos", json={"task": task, **extra})
    assert response.status_code == 201
    data: dict[str, Any] = response.json()
    return data


def _done(client: TestClient, todo_id: int, done: bool) -> dict[str, Any]:
    response = client.patch(f"/api/todos/{todo_id}", json={"done": done})
    assert response.status_code == 200
    data: dict[str, Any] = response.json()
    return data


def test_post_todo_returns_201_with_fields(client: TestClient) -> None:
    note = _note(client)

    response = client.post(
        f"/api/notes/{note['id']}/todos",
        json={"task": "보고서 검토", "owner": "민수", "due": "2026-11-01"},
    )
    assert response.status_code == 201
    data = response.json()
    assert set(data) == TODO_FIELDS
    assert isinstance(data["id"], int)
    assert data["note_id"] == note["id"]
    assert data["task"] == "보고서 검토"
    assert data["owner"] == "민수"
    assert data["due"] == "2026-11-01"
    assert data["done"] is False
    assert isinstance(data["created_at"], str)
    datetime.fromisoformat(data["created_at"])


def test_post_todo_owner_and_due_can_be_null_or_omitted(client: TestClient) -> None:
    note = _note(client)

    explicit = _todo(client, note["id"], "자료 정리", owner=None, due=None)
    assert explicit["owner"] is None
    assert explicit["due"] is None

    omitted = _todo(client, note["id"], "일정 확인")
    assert omitted["owner"] is None
    assert omitted["due"] is None
    assert omitted["done"] is False


def test_post_todo_for_missing_note_is_404(client: TestClient) -> None:
    _note(client)

    response = client.post("/api/notes/999999/todos", json={"task": "할 일"})
    assert response.status_code == 404
    assert client.get("/api/todos").json() == []


def test_post_todo_with_empty_task_is_422(client: TestClient) -> None:
    note = _note(client)

    response = client.post(f"/api/notes/{note['id']}/todos", json={"task": ""})
    assert response.status_code == 422
    assert client.get("/api/todos").json() == []


def test_post_todo_without_task_is_422(client: TestClient) -> None:
    note = _note(client)

    response = client.post(f"/api/notes/{note['id']}/todos", json={"owner": "민수"})
    assert response.status_code == 422
    assert client.get("/api/todos").json() == []


def test_list_todos_undone_first_then_newest(client: TestClient) -> None:
    first_note = _note(client, "첫 회의")
    second_note = _note(client, "둘째 회의")
    a = _todo(client, first_note["id"], "A")
    b = _todo(client, second_note["id"], "B")
    c = _todo(client, first_note["id"], "C")
    d = _todo(client, second_note["id"], "D")

    a_done = _done(client, a["id"], True)
    c_done = _done(client, c["id"], True)

    response = client.get("/api/todos")
    assert response.status_code == 200
    assert response.json() == [d, b, c_done, a_done]


def test_list_todos_filter_by_done(client: TestClient) -> None:
    note = _note(client)
    a = _todo(client, note["id"], "A")
    b = _todo(client, note["id"], "B")
    c = _todo(client, note["id"], "C")
    d = _todo(client, note["id"], "D")
    a_done = _done(client, a["id"], True)
    c_done = _done(client, c["id"], True)

    undone = client.get("/api/todos", params={"done": "false"})
    assert undone.status_code == 200
    assert undone.json() == [d, b]

    done = client.get("/api/todos", params={"done": "true"})
    assert done.status_code == 200
    assert done.json() == [c_done, a_done]


def test_list_todos_empty(client: TestClient) -> None:
    response = client.get("/api/todos")
    assert response.status_code == 200
    assert response.json() == []


def test_patch_todo_toggles_done(client: TestClient) -> None:
    note = _note(client)
    created = _todo(client, note["id"], "보고서 검토", owner="민수", due="2026-11-01")

    done = _done(client, created["id"], True)
    assert done == {**created, "done": True}

    undone = _done(client, created["id"], False)
    assert undone == created

    assert client.get("/api/todos").json() == [created]


def test_patch_missing_todo_is_404(client: TestClient) -> None:
    note = _note(client)
    _todo(client, note["id"], "할 일")

    response = client.patch("/api/todos/999999", json={"done": True})
    assert response.status_code == 404


def test_patch_todo_without_done_is_422(client: TestClient) -> None:
    note = _note(client)
    created = _todo(client, note["id"], "할 일")

    response = client.patch(f"/api/todos/{created['id']}", json={})
    assert response.status_code == 422
    assert client.get("/api/todos").json() == [created]


def test_note_api_unchanged_by_todos(client: TestClient) -> None:
    note = _note(client)
    _todo(client, note["id"], "할 일")

    assert client.get("/api/notes").json() == [note]
    response = client.get(f"/api/notes/{note['id']}")
    assert response.status_code == 200
    assert response.json() == note


def test_todos_persist_across_app_instances(settings: Settings) -> None:
    with TestClient(create_app(settings)) as first_client:
        note = _note(first_client)
        created = _todo(first_client, note["id"], "남는 할 일", owner="지현")
        done = _done(first_client, created["id"], True)

    with TestClient(create_app(settings)) as second_client:
        assert second_client.get("/api/todos").json() == [done]
