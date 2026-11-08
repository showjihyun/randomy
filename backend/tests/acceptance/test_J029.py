"""J029 할 일 기한 글자 해석(parse_due) 수락 테스트. 모델을 부르지 않는다."""

import ast
import importlib
import importlib.util
import sys
from datetime import date
from pathlib import Path
from types import ModuleType

import pytest

SUNDAY = date(2026, 11, 8)
MONDAY = date(2026, 11, 9)
WEDNESDAY = date(2026, 11, 11)
SATURDAY = date(2026, 11, 14)


def _module() -> ModuleType:
    assert importlib.util.find_spec("randomy.due_dates") is not None, (
        "randomy.due_dates 모듈이 없습니다"
    )
    return importlib.import_module("randomy.due_dates")


def _parse(text: str | None, base: date) -> date | None:
    result: date | None = _module().parse_due(text, base)
    return result


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2026-11-11", date(2026, 11, 11)),
        ("2026.11.11", date(2026, 11, 11)),
        ("2026/11/11", date(2026, 11, 11)),
        ("2026.1.5", date(2026, 1, 5)),
        ("2026/1/5", date(2026, 1, 5)),
        ("2020-01-01", date(2020, 1, 1)),
        ("  2026-11-11  ", date(2026, 11, 11)),
    ],
)
def test_full_dates(text: str, expected: date) -> None:
    assert _parse(text, SUNDAY) == expected


@pytest.mark.parametrize(
    ("text", "base", "expected"),
    [
        ("11월 11일", SUNDAY, date(2026, 11, 11)),
        ("11월11일", SUNDAY, date(2026, 11, 11)),
        ("1월 5일", SUNDAY, date(2027, 1, 5)),
        ("11월 8일", SUNDAY, date(2026, 11, 8)),
        ("11월 7일", SUNDAY, date(2027, 11, 7)),
        ("12월 31일", date(2026, 12, 31), date(2026, 12, 31)),
        ("1월 1일", date(2026, 12, 31), date(2027, 1, 1)),
        ("11/20", SUNDAY, date(2026, 11, 20)),
        ("1/5", SUNDAY, date(2027, 1, 5)),
        ("11/8", SUNDAY, date(2026, 11, 8)),
        ("11/7", SUNDAY, date(2027, 11, 7)),
    ],
)
def test_month_day_uses_base_year_or_next_year(text: str, base: date, expected: date) -> None:
    assert _parse(text, base) == expected


@pytest.mark.parametrize(
    ("text", "base", "expected"),
    [
        ("오늘", SUNDAY, date(2026, 11, 8)),
        ("내일", SUNDAY, date(2026, 11, 9)),
        ("모레", SUNDAY, date(2026, 11, 10)),
        ("내일", date(2026, 12, 31), date(2027, 1, 1)),
        ("내일모레", SUNDAY, date(2026, 11, 10)),
        ("  내일  ", SUNDAY, date(2026, 11, 9)),
    ],
)
def test_relative_days(text: str, base: date, expected: date) -> None:
    assert _parse(text, base) == expected


@pytest.mark.parametrize(
    ("text", "base", "expected"),
    [
        ("월요일", SUNDAY, date(2026, 11, 9)),
        ("화요일", SUNDAY, date(2026, 11, 10)),
        ("수요일", SUNDAY, date(2026, 11, 11)),
        ("목요일", SUNDAY, date(2026, 11, 12)),
        ("금요일", SUNDAY, date(2026, 11, 13)),
        ("토요일", SUNDAY, date(2026, 11, 14)),
        ("일요일", SUNDAY, date(2026, 11, 8)),
        ("수요일", WEDNESDAY, date(2026, 11, 11)),
        ("화요일", WEDNESDAY, date(2026, 11, 17)),
        ("목요일", WEDNESDAY, date(2026, 11, 12)),
    ],
)
def test_weekday_is_nearest_on_or_after_base(text: str, base: date, expected: date) -> None:
    assert _parse(text, base) == expected


@pytest.mark.parametrize(
    ("text", "base", "expected"),
    [
        ("이번 주 금요일", SUNDAY, date(2026, 11, 13)),
        ("이번주 금요일", SUNDAY, date(2026, 11, 13)),
        ("이번 주 금요일", SATURDAY, date(2026, 11, 20)),
        ("이번 주 수요일", WEDNESDAY, date(2026, 11, 11)),
    ],
)
def test_this_week_prefix_is_same_as_weekday(text: str, base: date, expected: date) -> None:
    assert _parse(text, base) == expected


@pytest.mark.parametrize(
    ("text", "base", "expected"),
    [
        ("다음 주 화요일", SUNDAY, date(2026, 11, 10)),
        ("다음 주 월요일", SUNDAY, date(2026, 11, 9)),
        ("다음 주 일요일", SUNDAY, date(2026, 11, 15)),
        ("다음 주 월요일", MONDAY, date(2026, 11, 16)),
        ("다음 주 일요일", MONDAY, date(2026, 11, 22)),
        ("다음 주 화요일", MONDAY, date(2026, 11, 17)),
        ("다음주 화요일", MONDAY, date(2026, 11, 17)),
        ("다음 주 화요일", WEDNESDAY, date(2026, 11, 17)),
        ("다음 주 일요일", SATURDAY, date(2026, 11, 22)),
    ],
)
def test_next_week_weekday_uses_monday_start_week(text: str, base: date, expected: date) -> None:
    assert _parse(text, base) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("11월 11일까지", date(2026, 11, 11)),
        ("2026-11-11까지", date(2026, 11, 11)),
        ("11/20까지", date(2026, 11, 20)),
        ("오늘까지", date(2026, 11, 8)),
        ("모레까지", date(2026, 11, 10)),
        ("금요일 오전", date(2026, 11, 13)),
        ("금요일까지 제출", date(2026, 11, 13)),
        ("다음 주 화요일까지", date(2026, 11, 10)),
    ],
)
def test_format_inside_other_text(text: str, expected: date) -> None:
    assert _parse(text, SUNDAY) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("금요일 오전 10시", date(2026, 11, 13)),
        ("내일 오후 3시", date(2026, 11, 9)),
        ("11월 11일 오전 10시", date(2026, 11, 11)),
        ("2026-11-11 10:00", date(2026, 11, 11)),
        ("11/20 10:00", date(2026, 11, 20)),
    ],
)
def test_time_is_ignored(text: str, expected: date) -> None:
    assert _parse(text, SUNDAY) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("11월 20일 금요일", date(2026, 11, 20)),
        ("11월 11일 또는 11월 13일", date(2026, 11, 11)),
    ],
)
def test_several_formats_use_rule_order_then_first(text: str, expected: date) -> None:
    assert _parse(text, SUNDAY) == expected


@pytest.mark.parametrize(
    "text",
    [
        "11월 둘째 주",
        "미정",
        "",
        "   ",
        None,
        "다음 주",
        "다음 주까지",
        "이번 주",
        "금",
        "오전 10시",
        "10:00",
    ],
)
def test_uninterpretable_is_none(text: str | None) -> None:
    assert _parse(text, SUNDAY) is None


@pytest.mark.parametrize(
    "text",
    [
        "2월 30일",
        "2/30",
        "13월 1일",
        "13/1",
        "0월 1일",
        "2월 0일",
        "2026-02-30",
        "2026.13.01",
        "2026/13/45",
        "100/200",
        "2월 30일 금요일",
    ],
)
def test_invalid_date_is_none(text: str) -> None:
    assert _parse(text, SUNDAY) is None


@pytest.mark.parametrize(
    ("text", "base", "expected"),
    [
        ("2월 29일", date(2028, 1, 15), date(2028, 2, 29)),
        ("2/29", date(2028, 1, 15), date(2028, 2, 29)),
        ("2월 29일", date(2028, 3, 1), None),
        ("2월 29일", date(2027, 3, 1), None),
    ],
)
def test_leap_day(text: str, base: date, expected: date | None) -> None:
    assert _parse(text, base) == expected


def test_imports_only_standard_library() -> None:
    source = Path(str(_module().__file__)).read_text(encoding="utf-8")
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0, "상대 import를 쓰면 안 됩니다"
            names.add((node.module or "").split(".")[0])
    assert names <= set(sys.stdlib_module_names), f"표준 라이브러리 밖: {names}"
