"""실행 설정. 모델 이름은 여기 한 곳에만 둔다 (기획안 1.2: 모델은 교체 가능한 부품)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# 실제 모델 연결(HIGH 작업) 전까지는 가짜 모델로 돈다
DEFAULT_MODEL = "fake"
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
