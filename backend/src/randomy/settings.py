"""실행 설정. 모델 이름은 여기 한 곳에만 둔다 (기획안 1.2: 모델은 교체 가능한 부품)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# 모델 값: "fake"(테스트·개발) 또는 "claude-cli:<별칭>"(로그인된 Claude Code CLI, 구독으로 호출).
# 기본은 가짜 모델이고, 실제 모델은 RANDOMY_MODEL로 고른다
DEFAULT_MODEL = "fake"
CLAUDE_CLI_PREFIX = "claude-cli:"
CLAUDE_CLI_MODELS = ("haiku", "sonnet", "opus")  # Claude Code가 최신 모델로 풀어 주는 별칭
DEFAULT_DB_PATH = Path.home() / ".randomy" / "randomy.db"


@dataclass(frozen=True)
class Settings:
    db_path: Path
    model: str = DEFAULT_MODEL

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            db_path=Path(os.environ.get("RANDOMY_DB_PATH") or DEFAULT_DB_PATH),
            model=os.environ.get("RANDOMY_MODEL") or DEFAULT_MODEL,
        )
