"""할 일의 자유 글 기한을 날짜로 해석한다. 모델을 부르지 않는 순수 함수."""

import re
from datetime import date, timedelta

_WEEKDAYS = "월화수목금토일"

_FULL = re.compile(r"(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)")
_MONTH_DAY_KO = re.compile(r"(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일")
_MONTH_DAY_SLASH = re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})(?!\d)")
_RELATIVE = re.compile(r"내일모레|모레|내일|오늘")
_NEXT_WEEK = re.compile(r"다음\s*주\s*([월화수목금토일])요일")
_WEEKDAY = re.compile(r"([월화수목금토일])요일")

_RELATIVE_DAYS = {"오늘": 0, "내일": 1, "모레": 2, "내일모레": 2}


def _make(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _month_day(month: int, day: int, base: date) -> date | None:
    this_year = _make(base.year, month, day)
    if this_year is None:
        return None
    if this_year >= base:
        return this_year
    return _make(base.year + 1, month, day)


def parse_due(text: str | None, base: date) -> date | None:
    """기한 글자를 날짜로 바꾼다. 해석하지 못하면 None."""
    if text is None:
        return None
    text = text.strip()
    if not text:
        return None

    m = _FULL.search(text)
    if m:
        return _make(int(m[1]), int(m[2]), int(m[3]))

    for pattern in (_MONTH_DAY_KO, _MONTH_DAY_SLASH):
        m = pattern.search(text)
        if m:
            return _month_day(int(m[1]), int(m[2]), base)

    m = _RELATIVE.search(text)
    if m:
        return base + timedelta(days=_RELATIVE_DAYS[m[0]])

    m = _NEXT_WEEK.search(text)
    if m:
        monday = base - timedelta(days=base.weekday())
        return monday + timedelta(days=7 + _WEEKDAYS.index(m[1]))

    m = _WEEKDAY.search(text)
    if m:
        ahead = (_WEEKDAYS.index(m[1]) - base.weekday()) % 7
        return base + timedelta(days=ahead)

    return None
