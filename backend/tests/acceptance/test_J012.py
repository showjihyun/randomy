"""J012 근거 붙인 답변 스킬·API 수락 테스트. 모델은 가짜만 쓴다."""

import importlib
import importlib.util
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.model import Completion, FakeModel, ModelError
from randomy.settings import Settings

SKILL_PATH = Path(__file__).resolve().parents[3] / "skills" / "answer-with-sources" / "SKILL.md"
SOURCE_FIELDS = {"id", "title", "created_at"}
NO_ANSWER = {"answer": "없음", "sources": []}


class NoCallModel:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, prompt: str) -> Completion:
        self.calls.append((system, prompt))
        raise AssertionError("모델을 부르면 안 됩니다")


class FailingModel:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, prompt: str) -> Completion:
        self.calls.append((system, prompt))
        raise ModelError("한도 초과")


def _client(settings: Settings, model: Any) -> TestClient:
    return TestClient(create_app(settings, model=model))


@pytest.fixture
def no_call() -> NoCallModel:
    return NoCallModel()


@pytest.fixture
def no_call_client(settings: Settings, no_call: NoCallModel) -> Iterator[TestClient]:
    with _client(settings, no_call) as test_client:
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


def _ask(client: TestClient, question: str) -> Any:
    return client.post("/api/ask", json={"question": question})


def _answer_json(answer: str, sources: list[int]) -> str:
    ids = ", ".join(str(i) for i in sources)
    return f'{{"answer": "{answer}", "sources": [{ids}]}}'


def _problems(response: Any) -> list[str]:
    assert response.status_code == 502, response.text
    detail = response.json()["detail"]
    assert isinstance(detail["message"], str)
    assert detail["message"]
    problems = detail["problems"]
    assert isinstance(problems, list)
    assert problems
    assert all(isinstance(p, str) for p in problems)
    return problems


def _ask_module() -> ModuleType:
    assert importlib.util.find_spec("randomy.ask") is not None, "randomy.ask 모듈이 없습니다"
    return importlib.import_module("randomy.ask")


# SKILL.md


def test_skill_file_states_rules() -> None:
    assert SKILL_PATH.exists(), "skills/answer-with-sources/SKILL.md가 없습니다"
    text = SKILL_PATH.read_text(encoding="utf-8")
    assert "answer" in text
    assert "sources" in text
    assert "없음" in text
    assert "JSON" in text
    assert "코드 블록" in text
    assert "만들지" in text


# 후보가 없을 때


def test_empty_database_answers_none_without_model(
    no_call_client: TestClient, no_call: NoCallModel
) -> None:
    response = _ask(no_call_client, "배포는 언제 하나요?")

    assert response.status_code == 200, response.text
    assert response.json() == NO_ANSWER
    assert no_call.calls == []


def test_no_match_answers_none_without_model(
    no_call_client: TestClient, no_call: NoCallModel
) -> None:
    _organize(no_call_client, title="예산 회의", body="예산을 늘린다", decisions=["예산 증액"])
    _plain_note(no_call_client, "메모", "장보기 목록")

    response = _ask(no_call_client, "채용 계획")

    assert response.status_code == 200, response.text
    assert response.json() == NO_ANSWER
    assert no_call.calls == []


# 후보가 있을 때 모델 호출


def test_candidates_are_sent_to_model_with_skill(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        hit = _organize(
            client,
            title="배포 회의",
            body="이번 주 배포 일정을 논의했다.",
            summary="배포 일정 논의",
            decisions=["배포는 금요일에 한다"],
        )
        _organize(client, title="예산 회의", body="예산 이야기", summary="예산 요약")

        response = _ask(client, "배포")

    assert response.status_code == 200, response.text
    assert len(fake.calls) == 1
    system, prompt = fake.calls[0]
    assert system == SKILL_PATH.read_text(encoding="utf-8")
    note_id = hit["note"]["id"]
    assert "배포" in prompt
    assert f"[노트 {note_id}]" in prompt
    assert "배포 회의" in prompt
    assert "배포 일정 논의" in prompt
    assert "배포는 금요일에 한다" in prompt
    assert "이번 주 배포 일정을 논의했다." in prompt
    assert "예산 회의" not in prompt
    assert prompt.count("[노트 ") == 1


def test_question_text_is_in_prompt(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        _organize(client, title="회의", body="배포 일정")
        response = _ask(client, "배포 일정 좀 알려줘")

    assert response.status_code == 200, response.text
    assert len(fake.calls) == 1
    assert "배포 일정 좀 알려줘" in fake.calls[0][1]


def test_question_words_are_searched_one_by_one_when_whole_misses(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        deploy = _organize(client, title="배포 회의", body="배포는 금요일")
        budget = _plain_note(client, "예산 메모", "예산 동결")
        _plain_note(client, "장보기", "우유")

        response = _ask(client, "배포 예산 언제야")

    assert response.status_code == 200, response.text
    assert len(fake.calls) == 1
    _, prompt = fake.calls[0]
    assert f"[노트 {deploy['note']['id']}]" in prompt
    assert f"[노트 {budget['id']}]" in prompt
    assert "장보기" not in prompt
    assert prompt.count("[노트 ") == 2


def test_note_found_only_by_decision_is_candidate(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        hit = _organize(
            client, title="주간 회의", body="여러 안건", summary="정리", decisions=["채용 보류"]
        )
        response = _ask(client, "채용")

    assert response.status_code == 200, response.text
    assert len(fake.calls) == 1
    assert f"[노트 {hit['note']['id']}]" in fake.calls[0][1]


def test_plain_note_without_summary_is_candidate(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        note = _plain_note(client, "메모", "장보기 목록: 우유, 계란")
        response = _ask(client, "우유")

    assert response.status_code == 200, response.text
    _, prompt = fake.calls[0]
    assert f"[노트 {note['id']}]" in prompt
    assert "장보기 목록: 우유, 계란" in prompt


def test_at_most_five_newest_candidates(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        made = [_organize(client, title=f"회의 {i}", body=f"배포 {i}") for i in range(7)]
        response = _ask(client, "배포")

    assert response.status_code == 200, response.text
    _, prompt = fake.calls[0]
    assert prompt.count("[노트 ") == 5
    for m in made[2:]:
        assert f"[노트 {m['note']['id']}]" in prompt
    for m in made[:2]:
        assert f"[노트 {m['note']['id']}]" not in prompt


def test_long_body_is_cut_in_prompt(settings: Settings) -> None:
    head = "배포 일정은 금요일로 정했다. "
    body = head + "가" * 20000 + "끝부분표시"
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        _organize(client, title="긴 회의", body=body)
        response = _ask(client, "배포")

    assert response.status_code == 200, response.text
    _, prompt = fake.calls[0]
    assert head in prompt
    assert "끝부분표시" not in prompt
    assert len(prompt) < len(body)


# 결과 처리


def test_valid_sources_get_titles(settings: Settings) -> None:
    with _client(settings, NoCallModel()) as setup:
        first = _organize(setup, title="배포 회의", body="배포는 금요일", decisions=["금요일 배포"])
        second = _plain_note(setup, "배포 메모", "배포 전 점검")
    first_id = first["note"]["id"]
    second_id = second["id"]
    fake = FakeModel(responses=[_answer_json("배포는 금요일에 한다.", [first_id, second_id])])
    with _client(settings, fake) as client:
        response = _ask(client, "배포")

    assert response.status_code == 200, response.text
    data = response.json()
    assert set(data) == {"answer", "sources"}
    assert data["answer"] == "배포는 금요일에 한다."
    for source in data["sources"]:
        assert set(source) == SOURCE_FIELDS
    assert data["sources"] == [
        {"id": first_id, "title": "배포 회의", "created_at": first["note"]["created_at"]},
        {"id": second_id, "title": "배포 메모", "created_at": second["created_at"]},
    ]
    assert len(fake.calls) == 1


def test_model_none_answer_is_returned(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        _organize(client, title="배포 회의", body="배포 이야기")
        response = _ask(client, "배포")

    assert response.status_code == 200, response.text
    assert response.json() == NO_ANSWER


def test_fenced_json_is_read(settings: Settings) -> None:
    with _client(settings, NoCallModel()) as setup:
        hit = _organize(setup, title="배포 회의", body="배포는 금요일")
    note_id = hit["note"]["id"]
    fenced = "```json\n" + _answer_json("금요일입니다.", [note_id]) + "\n```"
    fake = FakeModel(responses=[fenced])
    with _client(settings, fake) as client:
        response = _ask(client, "배포")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "answer": "금요일입니다.",
        "sources": [{"id": note_id, "title": "배포 회의", "created_at": hit["note"]["created_at"]}],
    }


def test_unknown_source_id_is_502(settings: Settings) -> None:
    with _client(settings, NoCallModel()) as setup:
        hit = _organize(setup, title="배포 회의", body="배포는 금요일")
        other = _plain_note(setup, "예산 메모", "예산 동결")
    note_id = hit["note"]["id"]
    fake = FakeModel(responses=[_answer_json("금요일", [note_id, 999])])
    with _client(settings, fake) as client:
        response = _ask(client, "배포")

    problems = _problems(response)
    assert any("999" in p for p in problems)

    fake2 = FakeModel(responses=[_answer_json("금요일", [other["id"]])])
    with _client(settings, fake2) as client:
        response = _ask(client, "배포")

    problems = _problems(response)
    assert any(str(other["id"]) in p for p in problems)


@pytest.mark.parametrize(
    "text",
    [
        "배포는 금요일입니다",
        "{}",
        '{"answer": "금요일"}',
        '{"sources": []}',
        '{"answer": 3, "sources": []}',
        '{"answer": "금요일", "sources": "1"}',
        '{"answer": "금요일", "sources": ["1"]}',
        '{"answer": "금요일", "sources": [1.5]}',
        '{"answer": "금요일", "sources": [true]}',
        '{"answer": "금요일", "sources": [], "extra": 1}',
        '["금요일"]',
    ],
)
def test_malformed_output_is_502(settings: Settings, text: str) -> None:
    fake = FakeModel(responses=[text])
    with _client(settings, fake) as client:
        _organize(client, title="배포 회의", body="배포는 금요일")
        response = _ask(client, "배포")

    _problems(response)
    assert len(fake.calls) == 1


def test_model_error_is_502(settings: Settings) -> None:
    failing = FailingModel()
    with _client(settings, failing) as client:
        _organize(client, title="배포 회의", body="배포는 금요일")
        response = _ask(client, "배포")

    assert response.status_code == 502, response.text
    _problems(response)
    assert len(failing.calls) == 1


# 요청 검사


@pytest.mark.parametrize("question", ["", " ", "  \t "])
def test_blank_question_is_422(
    no_call_client: TestClient, no_call: NoCallModel, question: str
) -> None:
    _organize(no_call_client, title="배포 회의", body="배포는 금요일")

    response = _ask(no_call_client, question)

    assert response.status_code == 422
    assert no_call.calls == []


@pytest.mark.parametrize("payload", [{}, {"question": 3}, {"question": None}])
def test_missing_or_non_string_question_is_422(
    no_call_client: TestClient, no_call: NoCallModel, payload: dict[str, Any]
) -> None:
    response = no_call_client.post("/api/ask", json=payload)

    assert response.status_code == 422
    assert no_call.calls == []


# 함수


def test_validate_answer() -> None:
    validate_answer = _ask_module().validate_answer

    assert validate_answer({"answer": "금요일", "sources": [1, 2]}) == []
    assert validate_answer({"answer": "없음", "sources": []}) == []
    for bad in [
        [],
        "금요일",
        {"sources": [1]},
        {"answer": "금요일"},
        {"answer": None, "sources": []},
        {"answer": "금요일", "sources": None},
        {"answer": "금요일", "sources": [1, "2"]},
        {"answer": "금요일", "sources": [False]},
        {"answer": "금요일", "sources": [], "note": "x"},
    ]:
        problems = validate_answer(bad)
        assert isinstance(problems, list)
        assert problems, bad
        assert all(isinstance(p, str) for p in problems)


def test_parse_answer() -> None:
    module = _ask_module()
    result_error = importlib.import_module("randomy.notes_result").ResultError

    assert module.parse_answer('{"answer": "금요일", "sources": [3]}') == {
        "answer": "금요일",
        "sources": [3],
    }
    fenced = '```json\n{"answer": "없음", "sources": []}\n```'
    assert module.parse_answer(fenced) == NO_ANSWER

    for bad in ["금요일", '{"answer": "금요일", "sources": ["3"]}']:
        with pytest.raises(result_error) as caught:
            module.parse_answer(bad)
        assert caught.value.problems


def test_existing_apis_unchanged(settings: Settings) -> None:
    fake = FakeModel(responses=[_answer_json("없음", [])])
    with _client(settings, fake) as client:
        organized = _organize(client, body="배포 일정", decisions=["배포는 금요일"])
        asked = _ask(client, "배포")
        assert asked.status_code == 200, asked.text
        assert asked.json() == NO_ANSWER

        notes = client.get("/api/notes")
        assert notes.status_code == 200
        assert notes.json() == [organized["note"]]
        decisions = client.get("/api/decisions")
        assert decisions.json() == organized["decisions"]
        search = client.get("/api/search", params={"q": "배포"})
        assert search.status_code == 200
        assert [n["id"] for n in search.json()["notes"]] == [organized["note"]["id"]]
