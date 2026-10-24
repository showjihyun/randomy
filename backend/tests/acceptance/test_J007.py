"""J007 회의록 정리 스킬 첫 판과 정리 API 수락 테스트. 모델은 가짜만 쓴다."""

import inspect
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from randomy import notes_result, skill_cli
from randomy.main import create_app
from randomy.model import Completion, FakeModel, ModelError
from randomy.settings import Settings

SKILL_PATH = Path(__file__).resolve().parents[3] / "skills" / "meeting-notes" / "SKILL.md"

RESULT: dict[str, Any] = {
    "summary": "주간 회의에서 배포 일정을 정했다.",
    "decisions": ["배포는 금요일에 한다"],
    "todos": [
        {"task": "보고서 작성", "owner": "민수", "due": "11월 1일"},
        {"task": "자료 정리", "owner": None, "due": None},
    ],
}
RESULT_TEXT = json.dumps(RESULT, ensure_ascii=False)
NOTE_TEXT = "주간 회의\n- 배포는 금요일에 하기로 함\n- 민수: 11월 1일까지 보고서 작성"


class FailingModel:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, prompt: str) -> Completion:
        self.calls.append((system, prompt))
        raise ModelError("한도 초과")


def _parse_result() -> Callable[[str], Any]:
    parse = getattr(notes_result, "parse_result", None)
    assert parse is not None, "randomy.notes_result.parse_result가 없습니다"
    assert callable(parse)
    return parse  # type: ignore[no-any-return]


def _result_error() -> type[Exception]:
    error = getattr(notes_result, "ResultError", None)
    assert isinstance(error, type), "randomy.notes_result.ResultError가 없습니다"
    assert issubclass(error, Exception)
    return error


def _problems_of(text: str) -> list[str]:
    parse = _parse_result()
    error_type = _result_error()
    with pytest.raises(error_type) as caught:
        parse(text)
    problems = getattr(caught.value, "problems", None)
    assert isinstance(problems, list)
    assert problems
    assert all(isinstance(problem, str) for problem in problems)
    return problems


def _client(settings: Settings, model: Any) -> TestClient:
    assert "model" in inspect.signature(create_app).parameters, "create_app에 model 인자가 없습니다"
    return TestClient(create_app(settings, model=model))


# (1) 스킬 지시문


def test_skill_instructions_exist_and_describe_result_format() -> None:
    assert SKILL_PATH.is_file()
    text = SKILL_PATH.read_text(encoding="utf-8")
    for word in ("JSON", "summary", "decisions", "todos", "task", "owner", "due", "null"):
        assert word in text, word


# (2) 모델 출력 읽기


@pytest.mark.parametrize(
    "text",
    [
        RESULT_TEXT,
        f"  \n{RESULT_TEXT}\n\n",
        f"```json\n{RESULT_TEXT}\n```",
        f"\n  ```json\n{RESULT_TEXT}\n```  \n",
        f"```\n{RESULT_TEXT}\n```",
    ],
)
def test_parse_result_strips_whitespace_and_code_fence(text: str) -> None:
    assert _parse_result()(text) == RESULT


def test_parse_result_rejects_non_json() -> None:
    _problems_of("정리 결과입니다: 배포는 금요일")


def test_parse_result_rejects_invalid_result_with_validate_problems() -> None:
    bad: dict[str, Any] = {"summary": "", "decisions": "금요일 배포", "todos": [{"task": "x"}]}
    problems = _problems_of(f"```json\n{json.dumps(bad, ensure_ascii=False)}\n```")
    assert problems == notes_result.validate_result(bad)


def test_skill_cli_parse_output_strips_code_fence() -> None:
    assert skill_cli.parse_output(f"```json\n{RESULT_TEXT}\n```") == RESULT
    assert skill_cli.parse_output(f"  ```\n{RESULT_TEXT}\n```\n") == RESULT
    assert skill_cli.parse_output(f"\n{RESULT_TEXT}\n") == RESULT
    assert skill_cli.parse_output("그냥 글") == "그냥 글"


# (3) POST /api/organize


def test_organize_calls_model_once_with_skill_and_returns_result(settings: Settings) -> None:
    model = FakeModel(responses=[f"```json\n{RESULT_TEXT}\n```"])
    with _client(settings, model) as client:
        response = client.post("/api/organize", json={"text": NOTE_TEXT})
        assert response.status_code == 200
        assert response.json() == RESULT

        assert len(model.calls) == 1
        system, prompt = model.calls[0]
        assert SKILL_PATH.is_file()
        assert system == SKILL_PATH.read_text(encoding="utf-8")
        assert prompt == NOTE_TEXT

        assert client.get("/api/notes").json() == []
        assert client.get("/api/todos").json() == []


@pytest.mark.parametrize("body", [{"text": ""}, {}])
def test_organize_without_text_is_422_and_does_not_call_model(
    settings: Settings, body: dict[str, Any]
) -> None:
    model = FakeModel(responses=[RESULT_TEXT])
    with _client(settings, model) as client:
        response = client.post("/api/organize", json=body)
        assert response.status_code == 422
        assert model.calls == []


def test_organize_invalid_model_output_is_502_with_problems(settings: Settings) -> None:
    bad: dict[str, Any] = {"summary": "요약", "decisions": [], "todos": [{"owner": "민수"}]}
    model = FakeModel(responses=[json.dumps(bad, ensure_ascii=False)])
    with _client(settings, model) as client:
        response = client.post("/api/organize", json={"text": NOTE_TEXT})
        assert response.status_code == 502
        detail = response.json()["detail"]
        assert isinstance(detail["message"], str)
        assert detail["problems"] == notes_result.validate_result(bad)
        assert client.get("/api/todos").json() == []


def test_organize_non_json_model_output_is_502_with_problems(settings: Settings) -> None:
    model = FakeModel(responses=["회의 내용을 정리하면 다음과 같습니다."])
    with _client(settings, model) as client:
        response = client.post("/api/organize", json={"text": NOTE_TEXT})
        assert response.status_code == 502
        problems = response.json()["detail"]["problems"]
        assert isinstance(problems, list)
        assert problems
        assert all(isinstance(problem, str) for problem in problems)


def test_organize_model_error_is_502(settings: Settings) -> None:
    model = FailingModel()
    with _client(settings, model) as client:
        response = client.post("/api/organize", json={"text": NOTE_TEXT})
        assert response.status_code == 502
        assert len(model.calls) == 1
        assert client.get("/api/notes").json() == []


def test_existing_apis_still_work_with_model_argument(settings: Settings) -> None:
    with _client(settings, FakeModel()) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok", "model": "fake"}
        created = client.post("/api/notes", json={"title": "회의", "body": "본문"})
        assert created.status_code == 201
        assert client.get("/api/notes").json() == [created.json()]
