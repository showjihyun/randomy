"""J019 주간 정리 시간대 처리 수락 테스트. 모델은 부르지 않는다."""

import inspect
import sqlite3
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone, tzinfo
from typing import Any

import pytest
from fastapi.testclient import TestClient

from randomy.main import create_app
from randomy.model import Completion
from randomy.settings import Settings
from randomy.weekly import WeeklyOut, week_range, weekly

KST = timezone(timedelta(hours=9))

# KST 2026-10-19(월) ~ 2026-10-25(일) 주
KST_MONDAY_0100 = "2026-10-18T16:00:00+00:00"  # UTC 일요일 16시
KST_MONDAY_2300 = "2026-10-19T14:00:00+00:00"  # UTC 월요일 14시
KST_SUNDAY_2359 = "2026-10-25T14:59:59+00:00"  # UTC 일요일 14:59:59
KST_NEXT_MONDAY_0000 = "2026-10-25T15:00:00+00:00"  # UTC 일요일 15시
KST_SUNDAY_BEFORE = "2026-10-18T14:59:59+00:00"  # KST 10-18(일) 23:59:59


class NoCallModel:
    def complete(self, system: str, prompt: str) -> Completion:
        raise AssertionError("모델을 부르면 안 됩니다")


@pytest.fixture
def app_client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings, model=NoCallModel())) as test_client:
        yield test_client


def _organize(
    client: TestClient, settings: Settings, created_at: str, *, title: str, decision: str
) -> int:
    """정리 결과를 저장한 뒤 노트·결정의 created_at을 지정한 UTC 시각으로 바꾼다."""
    response = client.post(
        "/api/organized",
        json={
            "title": title,
            "body": f"{title} 원문",
            "summary": "요약",
            "decisions": [decision],
            "todos": [],
        },
    )
    assert response.status_code == 201, response.text
    note_id: int = response.json()["note"]["id"]
    conn = sqlite3.connect(settings.db_path)
    try:
        with conn:
            conn.execute("UPDATE notes SET created_at = ? WHERE id = ?", (created_at, note_id))
            conn.execute(
                "UPDATE decisions SET created_at = ? WHERE note_id = ?", (created_at, note_id)
            )
    finally:
        conn.close()
    return note_id


def _weekly_in(settings: Settings, day: date | None, tz: tzinfo) -> WeeklyOut:
    assert "tz" in inspect.signature(weekly).parameters, "weekly()에 tz 인자가 없습니다"
    return weekly(settings.db_path, day, tz=tz)  # type: ignore[call-arg, arg-type, unused-ignore]


def _titles(result: WeeklyOut) -> list[str]:
    return [n.title for n in result.notes]


def _decision_texts(result: WeeklyOut) -> list[str]:
    return [d.text for d in result.decisions]


def test_kst_monday_early_and_late_belong_to_that_week(
    app_client: TestClient, settings: Settings
) -> None:
    early = _organize(
        app_client, settings, KST_MONDAY_0100, title="월요일 새벽", decision="새벽 결정"
    )
    late = _organize(app_client, settings, KST_MONDAY_2300, title="월요일 밤", decision="밤 결정")

    result = _weekly_in(settings, date(2026, 10, 19), KST)

    assert (result.start, result.end) == ("2026-10-19", "2026-10-25")
    assert [n.id for n in result.notes] == [early, late]
    assert _decision_texts(result) == ["새벽 결정", "밤 결정"]
    # 저장 형식(UTC ISO)은 그대로 돌려준다
    assert [n.created_at for n in result.notes] == [KST_MONDAY_0100, KST_MONDAY_2300]
    assert [d.created_at for d in result.decisions] == [KST_MONDAY_0100, KST_MONDAY_2300]


def test_kst_monday_early_is_not_in_previous_week(
    app_client: TestClient, settings: Settings
) -> None:
    _organize(app_client, settings, KST_MONDAY_0100, title="월요일 새벽", decision="새벽 결정")
    _organize(
        app_client, settings, KST_SUNDAY_BEFORE, title="지난 일요일 밤", decision="일요일 결정"
    )

    result = _weekly_in(settings, date(2026, 10, 12), KST)

    assert (result.start, result.end) == ("2026-10-12", "2026-10-18")
    assert _titles(result) == ["지난 일요일 밤"]
    assert _decision_texts(result) == ["일요일 결정"]


def test_kst_sunday_end_boundary(app_client: TestClient, settings: Settings) -> None:
    _organize(app_client, settings, KST_SUNDAY_2359, title="일요일 끝", decision="일요일 결정")
    _organize(
        app_client, settings, KST_NEXT_MONDAY_0000, title="다음 월요일", decision="다음 주 결정"
    )

    this_week = _weekly_in(settings, date(2026, 10, 21), KST)
    next_week = _weekly_in(settings, date(2026, 10, 26), KST)

    assert _titles(this_week) == ["일요일 끝"]
    assert _decision_texts(this_week) == ["일요일 결정"]
    assert (next_week.start, next_week.end) == ("2026-10-26", "2026-11-01")
    assert _titles(next_week) == ["다음 월요일"]
    assert _decision_texts(next_week) == ["다음 주 결정"]


@pytest.mark.parametrize("hours", [14, -12])
def test_missing_day_uses_today_in_given_tz(
    app_client: TestClient, settings: Settings, hours: int
) -> None:
    tz = timezone(timedelta(hours=hours))
    before = week_range(datetime.now(tz).date())
    result = _weekly_in(settings, None, tz)
    after = week_range(datetime.now(tz).date())
    got = (date.fromisoformat(result.start), date.fromisoformat(result.end))
    assert got in (before, after)


def test_default_tz_is_server_local(app_client: TestClient, settings: Settings) -> None:
    _organize(app_client, settings, KST_MONDAY_0100, title="경계 노트", decision="경계 결정")
    local_day = datetime.fromisoformat(KST_MONDAY_0100).astimezone().date()

    assert "tz" in inspect.signature(weekly).parameters, "weekly()에 tz 인자가 없습니다"
    result = weekly(settings.db_path, local_day)

    assert _titles(result) == ["경계 노트"]
    assert _decision_texts(result) == ["경계 결정"]
    previous = weekly(settings.db_path, local_day - timedelta(days=7))
    following = weekly(settings.db_path, local_day + timedelta(days=7))
    assert previous.notes == [] and following.notes == []


def test_router_uses_server_local_tz(app_client: TestClient, settings: Settings) -> None:
    _organize(app_client, settings, KST_MONDAY_0100, title="경계 노트", decision="경계 결정")
    local_day = datetime.fromisoformat(KST_MONDAY_0100).astimezone().date()

    assert "tz" in inspect.signature(weekly).parameters, "weekly()에 tz 인자가 없습니다"
    response = app_client.get("/api/weekly", params={"date": local_day.isoformat()})
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    assert [n["title"] for n in data["notes"]] == ["경계 노트"]
    assert [d["text"] for d in data["decisions"]] == ["경계 결정"]
    assert data == weekly(settings.db_path, local_day).model_dump()
