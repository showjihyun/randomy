"""모델 호출 경계. 테스트와 평가 전 개발은 가짜 모델을 쓴다."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from randomy.settings import CLAUDE_CLI_MODELS, CLAUDE_CLI_PREFIX, Settings


class ModelError(RuntimeError):
    """모델 호출 실패 (CLI 오류, 한도 초과, 응답 형식 오류)."""


@dataclass(frozen=True)
class Completion:
    text: str
    cost_usd: float = 0.0


class Model(Protocol):
    def complete(self, system: str, prompt: str) -> Completion: ...


@dataclass
class FakeModel:
    """정해 둔 응답을 순서대로 돌려준다. 응답이 없으면 빈 JSON 객체."""

    responses: list[str] = field(default_factory=list)
    calls: list[tuple[str, str]] = field(default_factory=list)

    def complete(self, system: str, prompt: str) -> Completion:
        self.calls.append((system, prompt))
        text = self.responses.pop(0) if self.responses else "{}"
        return Completion(text=text)


Runner = Callable[..., "subprocess.CompletedProcess[str]"]


@dataclass
class ClaudeCliModel:
    """로그인된 Claude Code CLI(`claude -p`)로 부른다. API 키 없이 구독으로 돈다.

    - 도구를 모두 끈다: 노트 원문 속 지시를 따라 파일·명령을 건드릴 수 없다.
    - 프로젝트 설정·hook·CLAUDE.md를 읽지 않도록 레포 밖 임시 폴더에서, 설정 없이 실행한다.
    - 원문은 표준 입력으로 보낸다. API 키는 넘기지 않는다 (구독 전용).
    - 비용은 CLI가 보고하는 API 환산 값이다 (구독은 실제 청구가 아니라 사용 한도에 잡힌다).
    """

    alias: str
    budget_usd: float = 0.5
    timeout_s: float = 180.0
    run: Runner = subprocess.run

    def complete(self, system: str, prompt: str) -> Completion:
        cmd = [
            "claude", "-p",
            "--output-format", "json",
            "--model", self.alias,
            "--system-prompt", system,
            "--tools", "",
            "--setting-sources", "",
            "--no-session-persistence",
            "--max-budget-usd", str(self.budget_usd),
        ]  # fmt: skip
        env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with tempfile.TemporaryDirectory(prefix="randomy-model-") as folder:
            done = self.run(
                cmd,
                input=prompt,
                cwd=folder,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.timeout_s,
                check=False,
            )
        try:
            data: dict[str, Any] = json.loads(done.stdout)
        except json.JSONDecodeError as error:
            raise ModelError(
                f"Claude CLI 응답을 읽을 수 없음 (exit {done.returncode}): {done.stderr[-300:]}"
            ) from error
        if data.get("is_error") or done.returncode != 0:
            raise ModelError(f"Claude CLI 오류: {data.get('result') or done.stderr[-300:]}")
        return Completion(
            text=str(data.get("result", "")), cost_usd=float(data.get("total_cost_usd") or 0.0)
        )


def get_model(settings: Settings) -> Model:
    if settings.model == "fake":
        return FakeModel()
    if settings.model.startswith(CLAUDE_CLI_PREFIX):
        alias = settings.model.removeprefix(CLAUDE_CLI_PREFIX)
        if alias in CLAUDE_CLI_MODELS:
            return ClaudeCliModel(alias=alias)
    raise ValueError(f"아직 연결하지 않은 모델입니다: {settings.model} (연결은 HIGH 작업)")
