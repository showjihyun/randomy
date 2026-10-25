"""근거 붙인 답변. 검색으로 후보 노트를 고르고 스킬 지시문으로 모델을 한 번 부른다."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from randomy.model import Model, ModelError
from randomy.notes_result import ResultError, strip_fence
from randomy.search import SearchResult, search

SKILL_PATH = Path(__file__).resolve().parents[3] / "skills" / "answer-with-sources" / "SKILL.md"
ANSWER_FIELDS = ("answer", "sources")
MAX_CANDIDATES = 5
BODY_MAX = 2000
NO_ANSWER = "없음"


def validate_answer(data: Any) -> list[str]:
    """결과의 문제 목록을 돌려준다. 문제가 없으면 빈 리스트."""
    if not isinstance(data, dict):
        return ["결과는 객체여야 합니다"]
    problems: list[str] = []
    if "answer" not in data:
        problems.append("answer 필드가 없습니다")
    elif not isinstance(data["answer"], str):
        problems.append("answer은(는) 문자열이어야 합니다")
    if "sources" not in data:
        problems.append("sources 필드가 없습니다")
    elif not isinstance(data["sources"], list):
        problems.append("sources은(는) 정수 목록이어야 합니다")
    else:
        for i, item in enumerate(data["sources"]):
            if isinstance(item, bool) or not isinstance(item, int):
                problems.append(f"sources[{i}]은(는) 정수여야 합니다")
    for name in data:
        if name not in ANSWER_FIELDS:
            problems.append(f"{name}은(는) 정해지지 않은 필드입니다")
    return problems


def parse_answer(text: str) -> dict[str, Any]:
    try:
        data = json.loads(strip_fence(text))
    except json.JSONDecodeError as error:
        raise ResultError([f"JSON으로 읽을 수 없습니다: {error.msg}"]) from error
    problems = validate_answer(data)
    if problems:
        raise ResultError(problems)
    assert isinstance(data, dict)
    return data


@dataclass
class Candidate:
    id: int
    title: str
    body: str
    created_at: str
    summary: str | None
    decisions: list[str]


def build_prompt(question: str, candidates: list[Candidate]) -> str:
    parts = [f"질문: {question}", "", "후보 노트:"]
    for c in candidates:
        decisions = "\n".join(f"- {d}" for d in c.decisions) if c.decisions else "없음"
        parts.append(
            f"[노트 {c.id}]\n"
            f"제목: {c.title}\n"
            f"요약: {c.summary if c.summary else '없음'}\n"
            f"결정:\n{decisions}\n"
            f"원문: {c.body[:BODY_MAX]}"
        )
    return "\n\n".join(parts)


def _candidate_ids(db_path: Path, question: str) -> list[int]:
    results: list[SearchResult] = [search(db_path, question)]
    if not results[0].notes and not results[0].decisions:
        results = [search(db_path, word) for word in question.split()]
    ids: list[int] = []
    for result in results:
        for note in result.notes:
            if note.id not in ids:
                ids.append(note.id)
        for decision in result.decisions:
            if decision.note_id not in ids:
                ids.append(decision.note_id)
    return ids[:MAX_CANDIDATES]


def _load_candidates(db_path: Path, ids: list[int]) -> list[Candidate]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        out: list[Candidate] = []
        for note_id in ids:
            row = conn.execute(
                "SELECT id, title, body, created_at FROM notes WHERE id = ?", (note_id,)
            ).fetchone()
            if row is None:
                continue
            summary = conn.execute(
                "SELECT summary FROM summaries WHERE note_id = ?", (note_id,)
            ).fetchone()
            decisions = conn.execute(
                "SELECT text FROM decisions WHERE note_id = ? ORDER BY id ASC", (note_id,)
            ).fetchall()
            out.append(
                Candidate(
                    id=row["id"],
                    title=row["title"],
                    body=row["body"],
                    created_at=row["created_at"],
                    summary=summary["summary"] if summary is not None else None,
                    decisions=[d["text"] for d in decisions],
                )
            )
        return out
    finally:
        conn.close()


class AskRequest(BaseModel):
    question: str


class SourceOut(BaseModel):
    id: int
    title: str
    created_at: str


class AskOut(BaseModel):
    answer: str
    sources: list[SourceOut]


def _bad_gateway(message: str, problems: list[str]) -> HTTPException:
    return HTTPException(status_code=502, detail={"message": message, "problems": problems})


def create_ask_router(db_path: Path, model_provider: Callable[[], Model]) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.post("/ask")
    def ask(request: AskRequest) -> AskOut:
        question = request.question
        if not question.strip():
            raise HTTPException(status_code=422, detail="question must not be blank")
        candidates = _load_candidates(db_path, _candidate_ids(db_path, question))
        if not candidates:
            return AskOut(answer=NO_ANSWER, sources=[])
        system = SKILL_PATH.read_text(encoding="utf-8")
        try:
            completion = model_provider().complete(system, build_prompt(question, candidates))
        except ModelError as error:
            raise _bad_gateway(f"모델 호출 실패: {error}", [str(error)]) from error
        try:
            data = parse_answer(completion.text)
        except ResultError as error:
            raise _bad_gateway("모델 출력이 형식에 맞지 않습니다", error.problems) from error
        by_id = {c.id: c for c in candidates}
        unknown = [i for i in data["sources"] if i not in by_id]
        if unknown:
            raise _bad_gateway(
                "모델이 후보에 없는 노트를 근거로 냈습니다",
                [f"sources에 후보가 아닌 노트 id가 있습니다: {i}" for i in unknown],
            )
        return AskOut(
            answer=data["answer"],
            sources=[
                SourceOut(id=i, title=by_id[i].title, created_at=by_id[i].created_at)
                for i in data["sources"]
            ],
        )

    return router
