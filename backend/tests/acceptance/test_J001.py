"""J001 노트 저장·목록 API 수락 테스트."""

from datetime import datetime

from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.settings import Settings


def _create(client: TestClient, title: str, body: str) -> dict[str, object]:
    response = client.post("/api/notes", json={"title": title, "body": body})
    assert response.status_code == 201
    data: dict[str, object] = response.json()
    return data


def test_post_note_returns_201_with_fields(client: TestClient) -> None:
    response = client.post("/api/notes", json={"title": "주간 회의", "body": "결정: 일정 유지"})
    assert response.status_code == 201
    data = response.json()
    assert set(data) == {"id", "title", "body", "created_at"}
    assert data["title"] == "주간 회의"
    assert data["body"] == "결정: 일정 유지"
    assert isinstance(data["created_at"], str)
    datetime.fromisoformat(data["created_at"])


def test_post_note_with_empty_body_is_422(client: TestClient) -> None:
    response = client.post("/api/notes", json={"title": "제목", "body": ""})
    assert response.status_code == 422
    assert client.get("/api/notes").json() == []


def test_post_note_without_body_is_422(client: TestClient) -> None:
    response = client.post("/api/notes", json={"title": "제목"})
    assert response.status_code == 422


def test_list_notes_newest_first(client: TestClient) -> None:
    first = _create(client, "첫째", "본문 1")
    second = _create(client, "둘째", "본문 2")
    third = _create(client, "셋째", "본문 3")

    response = client.get("/api/notes")
    assert response.status_code == 200
    assert response.json() == [third, second, first]


def test_get_note_by_id(client: TestClient) -> None:
    created = _create(client, "메모", "할 일: 보고서 검토")

    response = client.get(f"/api/notes/{created['id']}")
    assert response.status_code == 200
    assert response.json() == created


def test_get_missing_note_is_404(client: TestClient) -> None:
    _create(client, "메모", "본문")

    response = client.get("/api/notes/999999")
    assert response.status_code == 404


def test_notes_persist_across_app_instances(settings: Settings) -> None:
    with TestClient(create_app(settings)) as first_client:
        created = _create(first_client, "남는 노트", "다시 열어도 있다")

    assert settings.db_path.is_file()

    with TestClient(create_app(settings)) as second_client:
        assert second_client.get("/api/notes").json() == [created]
        response = second_client.get(f"/api/notes/{created['id']}")
        assert response.status_code == 200
        assert response.json() == created
