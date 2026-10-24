import json
from pathlib import Path

import pytest

from randomy import skill_cli


@pytest.fixture
def skills_dir(tmp_path: Path) -> Path:
    skill = tmp_path / "skills" / "echo"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("# echo\n입력을 정리한다.\n", encoding="utf-8")
    return tmp_path / "skills"


def test_runs_skill_with_its_instructions_and_prints_json(
    skills_dir: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "note.txt"
    source.write_text("회의록", encoding="utf-8")
    code = skill_cli.main(["echo", "--input", str(source), "--skills-dir", str(skills_dir)])
    assert code == 0
    result = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert result == {"skill": "echo", "output": {}, "cost_usd": 0.0}


def test_unknown_skill_is_an_error(
    skills_dir: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "note.txt"
    source.write_text("회의록", encoding="utf-8")
    code = skill_cli.main(["nope", "--input", str(source), "--skills-dir", str(skills_dir)])
    assert code == 2
    assert "nope" in capsys.readouterr().out


def test_non_json_model_output_is_kept_as_text() -> None:
    assert skill_cli.parse_output("그냥 글") == "그냥 글"
    assert skill_cli.parse_output('{"a": 1}') == {"a": 1}
