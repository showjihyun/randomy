"""J003 정리 결과 스키마와 검사 수락 테스트."""

import importlib
import importlib.util
import re

import pytest

HANGUL = re.compile(r"[가-힣]")


def _validate(data: object) -> list[str]:
    spec = importlib.util.find_spec("randomy.notes_result")
    assert spec is not None, "randomy.notes_result 모듈이 있어야 한다"
    module = importlib.import_module("randomy.notes_result")
    problems: list[str] = module.validate_result(data)
    assert isinstance(problems, list)
    assert all(isinstance(p, str) for p in problems)
    return problems


def _valid() -> dict[str, object]:
    return {
        "summary": "출시 일정을 논의했다.",
        "decisions": ["출시일은 11월 3일로 유지한다"],
        "todos": [
            {"task": "릴리스 노트 작성", "owner": "민수", "due": "2026-10-30"},
            {"task": "QA 일정 확인", "owner": None, "due": None},
        ],
    }


def _assert_problem_about(problems: list[str], field: str) -> None:
    assert problems, f"{field} 문제가 보고되어야 한다"
    assert any(field in p for p in problems), problems
    assert all(HANGUL.search(p) for p in problems), problems


def test_valid_result_has_no_problems() -> None:
    assert _validate(_valid()) == []


def test_empty_decisions_and_todos_are_valid() -> None:
    assert _validate({"summary": "논의만 했다.", "decisions": [], "todos": []}) == []


def test_non_object_is_a_problem() -> None:
    problems = _validate(["summary"])
    assert problems
    assert all(HANGUL.search(p) for p in problems), problems


@pytest.mark.parametrize("field", ["summary", "decisions", "todos"])
def test_missing_field_is_a_problem(field: str) -> None:
    data = _valid()
    del data[field]
    _assert_problem_about(_validate(data), field)


@pytest.mark.parametrize("value", ["", 3, None, ["요약"]])
def test_summary_must_be_non_empty_string(value: object) -> None:
    data = _valid()
    data["summary"] = value
    _assert_problem_about(_validate(data), "summary")


def test_decisions_must_be_list() -> None:
    data = _valid()
    data["decisions"] = "출시일 유지"
    _assert_problem_about(_validate(data), "decisions")


def test_decision_item_must_be_string() -> None:
    data = _valid()
    data["decisions"] = ["출시일 유지", 42]
    _assert_problem_about(_validate(data), "decisions[1]")


def test_todos_must_be_list() -> None:
    data = _valid()
    data["todos"] = {"task": "릴리스 노트 작성", "owner": None, "due": None}
    _assert_problem_about(_validate(data), "todos")


def test_todo_item_must_be_object() -> None:
    data = _valid()
    data["todos"] = ["릴리스 노트 작성"]
    _assert_problem_about(_validate(data), "todos[0]")


@pytest.mark.parametrize("value", ["", None, 7])
def test_todo_task_must_be_non_empty_string(value: object) -> None:
    data = _valid()
    data["todos"] = [
        {"task": "릴리스 노트 작성", "owner": None, "due": None},
        {"task": value, "owner": None, "due": None},
    ]
    _assert_problem_about(_validate(data), "todos[1].task")


@pytest.mark.parametrize("field", ["task", "owner", "due"])
def test_todo_missing_field_is_a_problem(field: str) -> None:
    todo: dict[str, object] = {"task": "릴리스 노트 작성", "owner": None, "due": None}
    del todo[field]
    data = _valid()
    data["todos"] = [todo]
    _assert_problem_about(_validate(data), f"todos[0].{field}")


@pytest.mark.parametrize("field", ["owner", "due"])
def test_todo_owner_and_due_must_be_string_or_null(field: str) -> None:
    todo: dict[str, object] = {"task": "릴리스 노트 작성", "owner": None, "due": None}
    todo[field] = 123
    data = _valid()
    data["todos"] = [todo]
    _assert_problem_about(_validate(data), f"todos[0].{field}")


def test_extra_top_level_field_is_a_problem() -> None:
    data = _valid()
    data["confidence"] = 0.9
    _assert_problem_about(_validate(data), "confidence")


def test_extra_todo_field_is_a_problem() -> None:
    data = _valid()
    data["todos"] = [{"task": "릴리스 노트 작성", "owner": None, "due": None, "priority": "높음"}]
    _assert_problem_about(_validate(data), "priority")


def test_all_problems_are_reported() -> None:
    data = {
        "summary": "",
        "decisions": [1],
        "todos": [{"task": "", "owner": None, "due": None}],
    }
    problems = _validate(data)
    assert any("summary" in p for p in problems), problems
    assert any("decisions[0]" in p for p in problems), problems
    assert any("todos[0].task" in p for p in problems), problems
