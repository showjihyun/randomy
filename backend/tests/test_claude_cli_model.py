import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from randomy.model import ClaudeCliModel, Completion, ModelError, get_model
from randomy.settings import CLAUDE_CLI_MODELS, Settings

REPO = Path(__file__).resolve().parents[2]


class FakeRun:
    """subprocess.run 대신 호출 내용을 기록하고 정해 둔 CLI 출력을 돌려준다."""

    def __init__(self, stdout: str, returncode: int = 0) -> None:
        self.stdout = stdout
        self.returncode = returncode
        self.calls: list[dict[str, Any]] = []

    def __call__(self, cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        self.calls.append({"cmd": cmd, **kwargs})
        return subprocess.CompletedProcess(cmd, self.returncode, self.stdout, "오류 내용")


def cli_output(result: str, cost: float = 0.02, is_error: bool = False) -> str:
    return json.dumps(
        {"type": "result", "is_error": is_error, "result": result, "total_cost_usd": cost}
    )


def test_calls_the_logged_in_claude_cli_without_tools_or_project_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-be-used")
    run = FakeRun(cli_output('{"summary": "요약"}'))
    model = ClaudeCliModel(alias="sonnet", run=run)
    completion = model.complete("지시문", "회의록 원문")
    assert completion == Completion(text='{"summary": "요약"}', cost_usd=0.02)
    call = run.calls[0]
    cmd = call["cmd"]
    assert cmd[0] == "claude" and "-p" in cmd
    assert cmd[cmd.index("--model") + 1] == "sonnet"
    assert cmd[cmd.index("--output-format") + 1] == "json"
    assert cmd[cmd.index("--system-prompt") + 1] == "지시문"
    # 도구를 끄고(원문 속 지시를 따라 행동할 수 없게) 프로젝트 설정·hook을 읽지 않는다
    assert cmd[cmd.index("--tools") + 1] == ""
    assert cmd[cmd.index("--setting-sources") + 1] == ""
    assert "--no-session-persistence" in cmd
    assert float(cmd[cmd.index("--max-budget-usd") + 1]) > 0
    # 원문은 명령줄이 아니라 표준 입력으로 보낸다
    assert call["input"] == "회의록 원문"
    assert "회의록 원문" not in cmd
    # 구독(로그인 세션)으로만 돈다: API 키를 넘기지 않는다
    assert "ANTHROPIC_API_KEY" not in call["env"]
    # 레포 밖에서 실행해 이 레포의 CLAUDE.md·팩토리 hook이 끼어들지 않게 한다
    assert REPO not in Path(call["cwd"]).resolve().parents
    assert Path(call["cwd"]).resolve() != REPO


def test_cli_error_raises_model_error() -> None:
    model = ClaudeCliModel(alias="sonnet", run=FakeRun(cli_output("한도 초과", is_error=True)))
    with pytest.raises(ModelError, match="한도 초과"):
        model.complete("지시문", "원문")


def test_cli_failure_without_json_raises_model_error() -> None:
    model = ClaudeCliModel(alias="sonnet", run=FakeRun("", returncode=1))
    with pytest.raises(ModelError, match="exit 1"):
        model.complete("지시문", "원문")


def test_settings_select_the_subscription_cli_model(tmp_path: Path) -> None:
    assert set(CLAUDE_CLI_MODELS) == {"haiku", "sonnet", "opus"}
    model = get_model(Settings(db_path=tmp_path / "x.db", model="claude-cli:sonnet"))
    assert isinstance(model, ClaudeCliModel)
    assert model.alias == "sonnet"
    with pytest.raises(ValueError, match="claude-cli:gpt"):
        get_model(Settings(db_path=tmp_path / "x.db", model="claude-cli:gpt"))
