"""제품 스킬 평가 (기획안 12.2 "스킬 동작" 검증, `make eval-skills`).

사용법:
    python scripts/eval_skills.py [<스킬>...] [--runs 3] [--min-pass 2] [--budget-usd 1.0]

`evals/skills/<스킬>/cases/*.json`의 케이스마다 스킬을 여러 번 실행해 판정한다.

- 케이스 형식: `{"id", "input", "expect": {"fields": [...], "contains": [...], "absent": [...]}}`
  - fields: 출력(JSON 객체)에 있어야 하는 필드
  - contains: 출력에 꼭 들어갈 내용 (결정 사항, 할 일 등)
  - absent: 원문에 없어 나오면 안 되는 내용. 나오면 지어내기로 센다
- 실행 1회 통과 = 위 조건 모두 만족. 케이스 통과 = `--runs`회 중 `--min-pass`회 이상.
- 스킬 통과 = 케이스 통과율 90% 이상 + 지어내기 0건.
- 평가 1회 비용이 `--budget-usd`를 넘으면 그 자리에서 멈추고 BUDGET으로 끝낸다.

스킬 실행은 `RANDOMY_SKILL_RUNNER`(JSON 명령 배열, 기본 `backend`의 `randomy.skill_cli`)에
`<스킬> --input <파일> --skills-dir <레포>/skills`를 붙여 부른다.
실행기는 마지막 줄에 `{"output", "cost_usd"}` JSON을 낸다.
결과는 마지막 줄 JSON. 종료 코드: 0 PASS, 1 FAIL, 2 사용 오류, 3 비용 상한.
평가 케이스는 사람이 만들고 승인한다 (잠금·HIGH). 비용 때문에 `verify`에 넣지 않는다.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from proc import resolve_command, use_utf8_output  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RUNNER_ENV = "RANDOMY_SKILL_RUNNER"
BACKEND = ROOT / "backend"
DEFAULT_RUNNER = [
    "uv", "run", "--project", str(BACKEND), "--no-sync", "python", "-m", "randomy.skill_cli",
]  # fmt: skip
PASS_RATE = 0.9


class BudgetExceeded(Exception):
    pass


def _runner() -> list[str]:
    raw = os.environ.get(RUNNER_ENV)
    return json.loads(raw) if raw else DEFAULT_RUNNER


def run_skill(root: Path, skill: str, text: str) -> tuple[Any, float]:
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / "input.txt"
        source.write_text(text, encoding="utf-8")
        cmd = [*_runner(), skill, "--input", str(source), "--skills-dir", str(root / "skills")]
        # 백엔드는 패키지 설치 없이 src/에서 읽는다. 출력은 Windows에서도 UTF-8로 읽는다
        python_path = os.pathsep.join(
            p for p in (str(BACKEND / "src"), os.environ.get("PYTHONPATH")) if p
        )
        done = subprocess.run(
            resolve_command(cmd),
            cwd=root,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONPATH": python_path},
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    lines = done.stdout.strip().splitlines()
    try:
        result = json.loads(lines[-1])
        return result.get("output"), float(result.get("cost_usd") or 0.0)
    except (IndexError, json.JSONDecodeError, AttributeError) as error:
        raise RuntimeError(
            f"스킬 실행기 출력이 JSON이 아님 (exit {done.returncode}): {done.stderr[-300:]}"
        ) from error


def check_run(output: Any, expect: dict[str, list[str]]) -> tuple[list[str], int]:
    """실행 1회의 문제 목록과 지어내기 수."""
    problems = []
    if not isinstance(output, dict):
        problems.append("출력이 JSON 객체가 아님")
    else:
        problems += [f"출력 필드 없음: {f}" for f in expect.get("fields", []) if f not in output]
    text = json.dumps(output, ensure_ascii=False)
    problems += [f"꼭 들어갈 내용 없음: {c}" for c in expect.get("contains", []) if c not in text]
    fabricated = [a for a in expect.get("absent", []) if a in text]
    problems += [f"지어낸 내용: {a}" for a in fabricated]
    return problems, len(fabricated)


def evaluate_skill(
    root: Path, skill: str, cases: list[Path], runs: int, min_pass: int, spent: list[float],
    budget: float,
) -> dict[str, Any]:  # fmt: skip
    results = []
    for path in cases:
        case = json.loads(path.read_text(encoding="utf-8"))
        passed = fabrications = 0
        problems: list[str] = []
        for _ in range(runs):
            output, cost = run_skill(root, skill, case["input"])
            spent[0] += cost
            run_problems, fabricated = check_run(output, case.get("expect", {}))
            passed += not run_problems
            fabrications += fabricated
            problems += [p for p in run_problems if p not in problems]
            if spent[0] > budget:
                raise BudgetExceeded
        results.append(
            {"id": case.get("id", path.stem), "passed_runs": passed, "runs": runs,
             "fabrications": fabrications, "problems": problems}
        )  # fmt: skip
    cases_passed = sum(r["passed_runs"] >= min_pass for r in results)
    fabrications_total = sum(r["fabrications"] for r in results)
    pass_rate = cases_passed / len(results)
    ok = pass_rate >= PASS_RATE and fabrications_total == 0
    return {
        "verdict": "PASS" if ok else "FAIL",
        "cases_passed": cases_passed,
        "cases_total": len(results),
        "pass_rate": round(pass_rate, 4),
        "fabrications": fabrications_total,
        "runs_per_case": runs,
        "cases": results,
    }


def main(argv: list[str] | None = None, root: Path = ROOT) -> int:
    use_utf8_output()
    parser = argparse.ArgumentParser(prog="eval_skills", description="제품 스킬 평가")
    parser.add_argument("skills", nargs="*", help="평가할 스킬 (없으면 전부)")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--min-pass", type=int, default=2)
    parser.add_argument("--budget-usd", type=float, default=1.0)
    args = parser.parse_args(argv)

    base = root / "evals" / "skills"
    names = args.skills or sorted(p.name for p in base.glob("*") if p.is_dir())
    plan = {name: sorted((base / name / "cases").glob("*.json")) for name in names}
    if not plan or not all(plan.values()):
        missing = [n for n, cases in plan.items() if not cases] or ["(스킬 없음)"]
        print(f"오류: 평가 케이스가 없습니다: {', '.join(missing)}")
        print("케이스 위치: evals/skills/<스킬>/cases/*.json")
        return 2

    spent = [0.0]
    report: dict[str, Any] = {}
    verdict = "PASS"
    try:
        for name, cases in plan.items():
            report[name] = evaluate_skill(
                root, name, cases, args.runs, args.min_pass, spent, args.budget_usd
            )
            if report[name]["verdict"] != "PASS":
                verdict = "FAIL"
    except BudgetExceeded:
        verdict = "BUDGET"

    for name, item in report.items():
        print(
            f"{name}: {item['verdict']} (케이스 {item['cases_passed']}/{item['cases_total']}, "
            f"지어내기 {item['fabrications']}건)"
        )
    if verdict == "BUDGET":
        print(f"비용 상한 ${args.budget_usd:.2f}을 넘어 멈췄습니다 (${spent[0]:.2f})")
    result = {"verdict": verdict, "cost_usd": round(spent[0], 6), "skills": report}
    print(json.dumps(result, ensure_ascii=False))
    return {"PASS": 0, "FAIL": 1, "BUDGET": 3}[verdict]


if __name__ == "__main__":
    sys.exit(main())
