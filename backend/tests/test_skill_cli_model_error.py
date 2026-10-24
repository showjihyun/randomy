from pathlib import Path

import pytest

from randomy import skill_cli
from randomy.model import Completion, ModelError


class BrokenModel:
    def complete(self, system: str, prompt: str) -> Completion:
        raise ModelError("구독 한도 초과")


def test_model_error_is_reported_without_json_and_exit_1(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    skill = tmp_path / "skills" / "echo"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("# echo\n", encoding="utf-8")
    source = tmp_path / "note.txt"
    source.write_text("회의록", encoding="utf-8")
    monkeypatch.setattr(skill_cli, "get_model", lambda settings: BrokenModel())
    code = skill_cli.main(
        ["echo", "--input", str(source), "--skills-dir", str(tmp_path / "skills")]
    )
    assert code == 1
    assert "구독 한도 초과" in capsys.readouterr().err
