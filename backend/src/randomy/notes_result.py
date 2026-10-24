"""회의록 정리 결과 형식과 검사."""

from typing import Any

TOP_FIELDS = ("summary", "decisions", "todos")
TODO_FIELDS = ("task", "owner", "due")


def _validate_todo(path: str, todo: Any, problems: list[str]) -> None:
    if not isinstance(todo, dict):
        problems.append(f"{path}은(는) 객체여야 합니다")
        return
    for name in TODO_FIELDS:
        field = f"{path}.{name}"
        if name not in todo:
            problems.append(f"{field} 필드가 없습니다")
            continue
        value = todo[name]
        if name == "task":
            if not isinstance(value, str) or not value:
                problems.append(f"{field}은(는) 빈 문자열이 아닌 문자열이어야 합니다")
        elif value is not None and not isinstance(value, str):
            problems.append(f"{field}은(는) 문자열 또는 null이어야 합니다")
    for name in todo:
        if name not in TODO_FIELDS:
            problems.append(f"{path}.{name}은(는) 정해지지 않은 필드입니다")


def validate_result(data: Any) -> list[str]:
    """결과의 문제 목록을 돌려준다. 문제가 없으면 빈 리스트."""
    if not isinstance(data, dict):
        return ["결과는 객체여야 합니다"]
    problems: list[str] = []

    if "summary" not in data:
        problems.append("summary 필드가 없습니다")
    elif not isinstance(data["summary"], str) or not data["summary"]:
        problems.append("summary은(는) 빈 문자열이 아닌 문자열이어야 합니다")

    if "decisions" not in data:
        problems.append("decisions 필드가 없습니다")
    elif not isinstance(data["decisions"], list):
        problems.append("decisions은(는) 문자열 목록이어야 합니다")
    else:
        for i, item in enumerate(data["decisions"]):
            if not isinstance(item, str):
                problems.append(f"decisions[{i}]은(는) 문자열이어야 합니다")

    if "todos" not in data:
        problems.append("todos 필드가 없습니다")
    elif not isinstance(data["todos"], list):
        problems.append("todos은(는) 객체 목록이어야 합니다")
    else:
        for i, todo in enumerate(data["todos"]):
            _validate_todo(f"todos[{i}]", todo, problems)

    for name in data:
        if name not in TOP_FIELDS:
            problems.append(f"{name}은(는) 정해지지 않은 필드입니다")
    return problems
