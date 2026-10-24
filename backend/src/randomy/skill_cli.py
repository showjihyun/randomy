"""제품 스킬 한 번 실행 (평가 `scripts/eval_skills.py`가 부른다).

사용법:
    python -m randomy.skill_cli <스킬> --input <입력 파일> [--skills-dir <폴더>]

`skills/<스킬>/SKILL.md`를 지시문으로, 입력 파일을 내용으로 모델을 한 번 부른다.
마지막 줄에 JSON `{"skill", "output", "cost_usd"}`를 출력한다.
모델은 설정(`RANDOMY_MODEL`)을 따른다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from randomy.model import ModelError, get_model
from randomy.notes_result import strip_fence
from randomy.settings import Settings

SKILLS_DIR = Path(__file__).resolve().parents[3] / "skills"


def parse_output(text: str) -> Any:
    try:
        return json.loads(strip_fence(text))
    except json.JSONDecodeError:
        return text


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="skill_cli", description="제품 스킬 한 번 실행")
    parser.add_argument("skill")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--skills-dir", type=Path, default=SKILLS_DIR)
    args = parser.parse_args(argv)

    instructions = args.skills_dir / args.skill / "SKILL.md"
    if not instructions.is_file():
        print(f"오류: 스킬이 없습니다: {args.skill} ({instructions})")
        return 2
    model = get_model(Settings.from_env())
    try:
        completion = model.complete(
            instructions.read_text(encoding="utf-8"), args.input.read_text(encoding="utf-8")
        )
    except ModelError as error:
        # 결과 JSON을 내지 않으므로 평가는 이 실행을 '실행기 오류'로 기록한다
        print(f"오류: 모델 호출 실패: {error}", file=sys.stderr)
        return 1
    result = {
        "skill": args.skill,
        "output": parse_output(completion.text),
        "cost_usd": completion.cost_usd,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
