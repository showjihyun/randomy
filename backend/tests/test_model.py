from pathlib import Path

import pytest

from randomy.model import Completion, FakeModel, get_model
from randomy.settings import DEFAULT_MODEL, Settings


def test_fake_model_returns_scripted_responses_in_order() -> None:
    model = FakeModel(responses=["첫째", "둘째"])
    assert model.complete("지시", "입력") == Completion(text="첫째", cost_usd=0.0)
    assert model.complete("지시", "입력").text == "둘째"
    assert model.calls == [("지시", "입력"), ("지시", "입력")]


def test_fake_model_without_script_answers_empty_json() -> None:
    assert FakeModel().complete("지시", "입력").text == "{}"


def test_settings_pick_the_fake_model_until_a_real_client_exists(tmp_path: Path) -> None:
    # 모델 이름은 설정 한 곳에만 둔다 (기획안 1.2). 실제 모델 연결은 HIGH 작업으로 따로 한다
    assert DEFAULT_MODEL == "fake"
    assert isinstance(get_model(Settings(db_path=tmp_path / "x.db")), FakeModel)
    with pytest.raises(ValueError, match="claude-sonnet-5-5"):
        get_model(Settings(db_path=tmp_path / "x.db", model="claude-sonnet-5-5"))


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("RANDOMY_DB_PATH", str(tmp_path / "env.db"))
    monkeypatch.setenv("RANDOMY_MODEL", "fake")
    settings = Settings.from_env()
    assert settings.db_path == tmp_path / "env.db"
    assert settings.model == "fake"
