"""모델 호출 경계. 테스트와 평가 전 개발은 가짜 모델을 쓴다."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from randomy.settings import Settings


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


def get_model(settings: Settings) -> Model:
    if settings.model == "fake":
        return FakeModel()
    raise ValueError(f"아직 연결하지 않은 모델입니다: {settings.model} (연결은 HIGH 작업)")
