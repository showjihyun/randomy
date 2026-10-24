import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import eval_skills  # noqa: E402

# 스킬 실행기를 흉내 낸다. 입력 내용에 따라 출력이 달라지고, 호출 횟수는 상태 파일에 센다.
FAKE_RUNNER = r"""
import json, os, sys
from pathlib import Path
skill = sys.argv[1]
text = Path(sys.argv[sys.argv.index("--input") + 1]).read_text(encoding="utf-8")
state = Path(os.environ["FAKE_STATE"])
calls = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {}
calls[text] = calls.get(text, 0) + 1
state.write_text(json.dumps(calls), encoding="utf-8")
n = calls[text]
good = {"summary": "요약", "decisions": ["배포는 금요일"], "todos": ["문서 정리"]}
if "ONE_OF_THREE" in text:
    output = good if n % 3 == 1 else {"summary": "요약", "decisions": [], "todos": []}
elif "TWO_OF_THREE" in text:
    output = good if n % 3 != 0 else {"summary": "요약", "decisions": [], "todos": []}
elif "FABRICATE" in text:
    output = dict(good, todos=["문서 정리", "회식 예약"]) if n == 1 else good
elif "NO_FIELDS" in text:
    output = {"summary": "요약"}
else:
    output = good
print("로그 한 줄")
cost = float(os.environ.get("FAKE_COST", "0"))
print(json.dumps({"skill": skill, "output": output, "cost_usd": cost}, ensure_ascii=False))
"""


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    runner = tmp_path / "fake_runner.py"
    runner.write_text(FAKE_RUNNER, encoding="utf-8")
    monkeypatch.setenv(eval_skills.RUNNER_ENV, json.dumps([sys.executable, str(runner)]))
    monkeypatch.setenv("FAKE_STATE", str(tmp_path / "calls.json"))
    return tmp_path / "repo"


def add_case(root: Path, skill: str, case_id: str, text: str) -> None:
    cases = root / "evals" / "skills" / skill / "cases"
    cases.mkdir(parents=True, exist_ok=True)
    case = {
        "id": case_id,
        "input": text,
        "expect": {
            "fields": ["summary", "decisions", "todos"],
            "contains": ["배포는 금요일"],
            "absent": ["회식 예약"],
        },
    }
    (cases / f"{case_id}.json").write_text(json.dumps(case, ensure_ascii=False), "utf-8")


def evaluate(
    root: Path, capsys: pytest.CaptureFixture[str], *args: str
) -> tuple[int, dict[str, object]]:
    code = eval_skills.main(list(args), root=root)
    result = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    return code, result


def skill_result(result: dict[str, object], skill: str) -> dict[str, object]:
    skills = result["skills"]
    assert isinstance(skills, dict)
    value = skills[skill]
    assert isinstance(value, dict)
    return value


def test_all_cases_passing_is_pass(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    add_case(root, "notes", "c1", "회의록 1")
    add_case(root, "notes", "c2", "회의록 2")
    code, result = evaluate(root, capsys)
    assert code == 0
    assert result["verdict"] == "PASS"
    notes = skill_result(result, "notes")
    assert notes["cases_passed"] == 2 and notes["cases_total"] == 2
    assert notes["runs_per_case"] == 3


def test_case_passes_with_two_of_three_runs(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    add_case(root, "notes", "c1", "TWO_OF_THREE")
    code, result = evaluate(root, capsys)
    assert code == 0
    assert skill_result(result, "notes")["cases"] == [
        {"id": "c1", "passed_runs": 2, "runs": 3, "fabrications": 0,
         "problems": ["꼭 들어갈 내용 없음: 배포는 금요일"]},
    ]  # fmt: skip


def test_case_with_one_of_three_runs_fails_and_drops_the_pass_rate(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    add_case(root, "notes", "c1", "회의록 1")
    add_case(root, "notes", "c2", "ONE_OF_THREE")
    code, result = evaluate(root, capsys)
    assert code == 1
    assert result["verdict"] == "FAIL"
    assert skill_result(result, "notes")["pass_rate"] == 0.5


def test_nine_of_ten_cases_is_enough(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    for i in range(9):
        add_case(root, "notes", f"c{i}", f"회의록 {i}")
    add_case(root, "notes", "c9", "ONE_OF_THREE")
    code, result = evaluate(root, capsys)
    assert code == 0
    assert skill_result(result, "notes")["pass_rate"] == 0.9


def test_any_fabrication_fails_the_skill(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # 케이스는 3회 중 2회 통과했지만 지어낸 할 일이 한 번이라도 나오면 스킬은 불합격
    add_case(root, "notes", "c1", "FABRICATE")
    code, result = evaluate(root, capsys)
    assert code == 1
    notes = skill_result(result, "notes")
    assert notes["fabrications"] == 1
    assert notes["cases_passed"] == 1
    assert notes["verdict"] == "FAIL"


def test_missing_output_fields_fail_the_run(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    add_case(root, "notes", "c1", "NO_FIELDS")
    code, result = evaluate(root, capsys)
    assert code == 1
    problems = skill_result(result, "notes")["cases"]
    assert isinstance(problems, list)
    assert "출력 필드 없음: decisions" in problems[0]["problems"]


def test_budget_stops_the_evaluation(
    root: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_COST", "0.4")
    add_case(root, "notes", "c1", "회의록 1")
    add_case(root, "notes", "c2", "회의록 2")
    code, result = evaluate(root, capsys, "--budget-usd", "1.0")
    assert code == 3
    assert result["verdict"] == "BUDGET"
    assert result["cost_usd"] == pytest.approx(1.2)  # 상한을 넘긴 호출에서 멈춘다


def test_selected_skill_only(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    add_case(root, "notes", "c1", "회의록 1")
    add_case(root, "search", "c1", "ONE_OF_THREE")
    code, result = evaluate(root, capsys, "notes")
    assert code == 0
    assert set(result["skills"]) == {"notes"}  # type: ignore[arg-type]


def test_default_runner_runs_the_backend_skill_of_the_evaluated_repo(
    root: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # 기본 실행기(백엔드 randomy.skill_cli, 가짜 모델)가 평가 대상 레포의 skills/를 읽는다
    monkeypatch.delenv(eval_skills.RUNNER_ENV)
    monkeypatch.delenv("RANDOMY_MODEL", raising=False)
    (root / "skills" / "notes").mkdir(parents=True)
    (root / "skills" / "notes" / "SKILL.md").write_text("# notes\n", encoding="utf-8")
    add_case(root, "notes", "c1", "회의록 1")
    code, result = evaluate(root, capsys, "--runs", "1", "--min-pass", "1")
    assert code == 1  # 가짜 모델은 빈 JSON을 돌려주므로 실행은 되고 판정은 불합격
    cases = skill_result(result, "notes")["cases"]
    assert isinstance(cases, list)
    assert "출력 필드 없음: summary" in cases[0]["problems"]


def test_no_cases_is_an_error(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = eval_skills.main([], root=root)
    assert code == 2
    assert "평가 케이스" in capsys.readouterr().out
