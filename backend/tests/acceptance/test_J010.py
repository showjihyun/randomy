"""J010 검색 API 수락 테스트. 모델은 부르지 않는다."""

import importlib
import importlib.util
from collections.abc import Callable, Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.model import Completion
from randomy.settings import Settings

NOTE_HIT_FIELDS = {"id", "title", "snippet", "created_at"}
DECISION_HIT_FIELDS = {"id", "note_id", "note_title", "text", "created_at"}
SNIPPET_MAX = 120


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
    title: str = "회의",
    body: str = "본문",
    summary: str = "요약",
    decisions: list[str] | None = None,
) -> dict[str, Any]:
    response = client.post(
        "/api/organized",
        json={
            "title": title,
            "body": body,
            "summary": summary,
            "decisions": decisions or [],
            "todos": [],
        },
    )
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


def _plain_note(client: TestClient, title: str, body: str) -> dict[str, Any]:
    response = client.post("/api/notes", json={"title": title, "body": body})
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


def _search(client: TestClient, q: str) -> dict[str, Any]:
    response = client.get("/api/search", params={"q": q})
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    assert set(data) == {"notes", "decisions"}
    for note in data["notes"]:
        assert set(note) == NOTE_HIT_FIELDS
    for decision in data["decisions"]:
        assert set(decision) == DECISION_HIT_FIELDS
    return data


def test_word_in_body_and_decision_is_found(app_client: TestClient, model: NoCallModel) -> None:
    hit = _organize(
        app_client,
        title="주간 회의",
        body="이번 주 배포 일정을 논의했다.",
        summary="일정 논의",
        decisions=["배포는 금요일에 한다", "회의는 격주로 한다"],
    )
    _organize(app_client, title="다른 회의", body="예산 이야기", decisions=["예산을 늘린다"])

    data = _search(app_client, "배포")

    assert len(data["notes"]) == 1
    note = data["notes"][0]
    assert note["id"] == hit["note"]["id"]
    assert note["title"] == "주간 회의"
    assert note["created_at"] == hit["note"]["created_at"]
    datetime.fromisoformat(note["created_at"])
    assert "배포" in note["snippet"]
    assert note["snippet"] in hit["note"]["body"]

    assert len(data["decisions"]) == 1
    decision = data["decisions"][0]
    first_decision = hit["decisions"][0]
    assert decision == {
        "id": first_decision["id"],
        "note_id": hit["note"]["id"],
        "note_title": "주간 회의",
        "text": "배포는 금요일에 한다",
        "created_at": first_decision["created_at"],
    }

    assert model.calls == []


def test_word_in_title_is_found(app_client: TestClient) -> None:
    hit = _organize(app_client, title="분기 계획", body="내용 정리", summary="정리")
    _organize(app_client, title="다른 것", body="내용 정리", summary="정리")

    data = _search(app_client, "분기")

    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]
    assert data["decisions"] == []


def test_word_only_in_summary_is_found(app_client: TestClient) -> None:
    body = "오늘은 여러 가지 이야기를 나눴다. 자세한 내용은 따로 적는다."
    hit = _organize(app_client, title="회의", body=body, summary="신규 채용 계획을 세웠다")
    _organize(app_client, title="회의", body=body, summary="다른 요약")

    data = _search(app_client, "채용")

    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]
    snippet = data["notes"][0]["snippet"]
    assert snippet
    assert body.startswith(snippet)
    assert len(snippet) <= SNIPPET_MAX


def test_plain_note_without_summary_is_searched(app_client: TestClient) -> None:
    note = _plain_note(app_client, "메모", "장보기 목록: 우유, 계란")

    data = _search(app_client, "우유")

    assert [n["id"] for n in data["notes"]] == [note["id"]]
    assert data["decisions"] == []


def test_two_words_must_both_match(app_client: TestClient) -> None:
    both = _organize(
        app_client,
        body="배포 일정과 예산을 함께 정했다",
        decisions=["배포 예산은 동결한다"],
    )
    _organize(app_client, body="배포 일정만 정했다", decisions=["배포는 금요일"])
    _organize(app_client, body="예산만 정했다", decisions=["예산을 늘린다"])

    data = _search(app_client, "배포 예산")

    assert [n["id"] for n in data["notes"]] == [both["note"]["id"]]
    assert [d["text"] for d in data["decisions"]] == ["배포 예산은 동결한다"]


def test_words_may_match_different_fields(app_client: TestClient) -> None:
    hit = _organize(app_client, title="배포 회의", body="일정 논의", summary="예산 확인")
    _organize(app_client, title="배포 회의", body="일정 논의", summary="다른 요약")

    data = _search(app_client, "배포 예산")

    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]


def test_extra_spaces_between_words(app_client: TestClient) -> None:
    hit = _organize(app_client, body="배포 일정과 예산", decisions=["배포 예산 확정"])

    data = _search(app_client, "  배포   예산  ")

    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]
    assert [d["text"] for d in data["decisions"]] == ["배포 예산 확정"]


def test_case_insensitive(app_client: TestClient) -> None:
    hit = _organize(
        app_client,
        title="Release",
        body="We discussed the Deploy plan.",
        decisions=["DEPLOY on Friday"],
    )
    _organize(app_client, body="nothing here", decisions=["other"])

    data = _search(app_client, "deploy")

    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]
    assert "Deploy" in data["notes"][0]["snippet"]
    assert [d["text"] for d in data["decisions"]] == ["DEPLOY on Friday"]

    upper = _search(app_client, "RELEASE")
    assert [n["id"] for n in upper["notes"]] == [hit["note"]["id"]]


def test_percent_is_matched_literally(app_client: TestClient) -> None:
    hit = _organize(app_client, body="진행률 100% 완료", decisions=["목표 50% 달성"])
    _organize(app_client, body="진행률 100 완료", decisions=["목표 50 달성"])

    data = _search(app_client, "%")

    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]
    assert "%" in data["notes"][0]["snippet"]
    assert [d["text"] for d in data["decisions"]] == ["목표 50% 달성"]


def test_underscore_is_matched_literally(app_client: TestClient) -> None:
    hit = _organize(app_client, body="파일 a_b 정리", decisions=["x_y 사용"])
    _organize(app_client, body="파일 acb 정리", decisions=["xzy 사용"])

    data = _search(app_client, "a_b")
    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]

    decisions = _search(app_client, "x_y")
    assert [d["text"] for d in decisions["decisions"]] == ["x_y 사용"]


def test_backslash_is_matched_literally(app_client: TestClient) -> None:
    hit = _organize(app_client, body="경로 C:\\temp 확인")
    _organize(app_client, body="경로 C:temp 확인")

    data = _search(app_client, "C:\\temp")

    assert [n["id"] for n in data["notes"]] == [hit["note"]["id"]]


@pytest.mark.parametrize("q", ["", " ", "   \t  "])
def test_blank_query_is_422(app_client: TestClient, q: str) -> None:
    _organize(app_client, body="배포 일정", decisions=["배포"])

    response = app_client.get("/api/search", params={"q": q})
    assert response.status_code == 422


def test_missing_query_is_422(app_client: TestClient) -> None:
    response = app_client.get("/api/search")
    assert response.status_code == 422


def test_no_match_returns_empty_lists(app_client: TestClient) -> None:
    _organize(app_client, body="배포 일정", decisions=["배포는 금요일"])
    _plain_note(app_client, "메모", "장보기")

    data = _search(app_client, "존재하지않는단어")

    assert data == {"notes": [], "decisions": []}


def test_empty_database_returns_empty_lists(app_client: TestClient) -> None:
    assert _search(app_client, "배포") == {"notes": [], "decisions": []}


def test_results_are_newest_first(app_client: TestClient) -> None:
    first = _organize(app_client, title="첫째", body="배포 1", decisions=["배포 A", "배포 B"])
    second = _plain_note(app_client, "둘째", "배포 2")
    third = _organize(app_client, title="셋째", body="배포 3", decisions=["배포 C"])

    data = _search(app_client, "배포")

    assert [n["id"] for n in data["notes"]] == [
        third["note"]["id"],
        second["id"],
        first["note"]["id"],
    ]
    created = [n["created_at"] for n in data["notes"]]
    assert created == sorted(created, reverse=True)

    assert [d["text"] for d in data["decisions"]] == ["배포 C", "배포 B", "배포 A"]
    assert [d["note_title"] for d in data["decisions"]] == ["셋째", "첫째", "첫째"]
    created = [d["created_at"] for d in data["decisions"]]
    assert created == sorted(created, reverse=True)


def test_each_list_is_limited_to_20(app_client: TestClient) -> None:
    made = [
        _organize(app_client, title=f"회의 {i}", body=f"배포 {i}", decisions=[f"배포 결정 {i}"])
        for i in range(25)
    ]

    data = _search(app_client, "배포")

    newest = list(reversed(made))[:20]
    assert [n["id"] for n in data["notes"]] == [m["note"]["id"] for m in newest]
    assert [d["id"] for d in data["decisions"]] == [m["decisions"][0]["id"] for m in newest]


def test_snippet_is_around_first_match(app_client: TestClient) -> None:
    body = "가" * 300 + " 배포 일정 확정 " + "나" * 300 + " 배포 다시 " + "다" * 300
    _organize(app_client, body=body)

    data = _search(app_client, "배포")

    snippet = data["notes"][0]["snippet"]
    assert "배포 일정" in snippet
    assert snippet in body
    assert len(snippet) <= SNIPPET_MAX
    assert len(snippet) > len("배포")


def test_short_body_snippet_is_whole_body(app_client: TestClient) -> None:
    _organize(app_client, body="짧은 배포 메모")

    data = _search(app_client, "배포")

    assert data["notes"][0]["snippet"] == "짧은 배포 메모"


def _search_function() -> Callable[..., Any]:
    assert importlib.util.find_spec("randomy.search") is not None, "randomy.search 모듈이 없습니다"
    search: Callable[..., Any] = importlib.import_module("randomy.search").search
    return search


def test_search_function_is_usable_without_router(
    app_client: TestClient, settings: Settings
) -> None:
    search = _search_function()
    older = _organize(app_client, title="첫째", body="배포 1", decisions=["배포 A"])
    newer = _organize(app_client, title="둘째", body="배포 2", decisions=["배포 B"])
    _organize(app_client, title="셋째", body="예산", decisions=["예산"])

    result = search(settings.db_path, "배포")
    assert [n.id for n in result.notes] == [newer["note"]["id"], older["note"]["id"]]
    assert [d.text for d in result.decisions] == ["배포 B", "배포 A"]
    assert [d.note_title for d in result.decisions] == ["둘째", "첫째"]

    limited = search(settings.db_path, "배포", limit=1)
    assert [n.id for n in limited.notes] == [newer["note"]["id"]]
    assert [d.text for d in limited.decisions] == ["배포 B"]


def test_existing_apis_unchanged(app_client: TestClient) -> None:
    organized = _organize(app_client, body="배포 일정", decisions=["배포는 금요일"])
    note = _plain_note(app_client, "메모", "배포 메모")

    _search(app_client, "배포")

    notes = app_client.get("/api/notes")
    assert notes.status_code == 200
    assert notes.json() == [note, organized["note"]]
    decisions = app_client.get("/api/decisions")
    assert decisions.status_code == 200
    assert decisions.json() == organized["decisions"]
