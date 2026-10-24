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
elif "DECISION_LEAK" in text:
    output = dict(good, decisions=["배포는 금요일", "휴교 실시"])
elif "SUMMARY_MENTION" in text:
    output = dict(good, summary="휴교는 이번에 하지 않기로 함")
elif "CRASH" in text:
    print("Traceback: 실행기가 죽었다", file=sys.stderr)
    sys.exit(1)
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


def add_case(
    root: Path,
    skill: str,
    case_id: str,
    text: str,
    absent_in: dict[str, list[str]] | None = None,
) -> None:
    cases = root / "evals" / "skills" / skill / "cases"
    cases.mkdir(parents=True, exist_ok=True)
    case: dict[str, object] = {
        "id": case_id,
        "input": text,
        "expect": {
            "fields": ["summary", "decisions", "todos"],
            "contains": ["배포는 금요일"],
            "absent": ["회식 예약"],
            **({"absent_in": absent_in} if absent_in else {}),
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


def test_each_run_output_is_saved_for_later_inspection(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # 실패 원인을 다시 돌려 보지 않고 볼 수 있게 실행마다 출력과 문제를 남긴다 (H7)
    add_case(root, "notes", "c1", "TWO_OF_THREE")
    add_case(root, "notes", "c2", "CRASH")
    code, result = evaluate(root, capsys)
    saved = Path(str(result["results_path"]))
    assert saved.parent == root / "evals" / "results"
    record = json.loads(saved.read_text(encoding="utf-8"))
    runs = record["skills"]["notes"]["cases"][0]["run_outputs"]
    assert [r["passed"] for r in runs] == [True, True, False]
    assert runs[2]["output"]["decisions"] == []
    assert "꼭 들어갈 내용 없음: 배포는 금요일" in runs[2]["problems"]
    crashed = record["skills"]["notes"]["cases"][1]["run_outputs"]
    assert crashed[0]["output"] is None and "실행기 오류" in crashed[0]["problems"][0]
    # 화면에 찍는 요약에는 출력 전문을 넣지 않는다
    assert "run_outputs" not in json.dumps(result, ensure_ascii=False)


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


def test_field_scoped_absent_counts_as_fabrication(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # 보류·기각된 안건이 결정 사항 칸에 들어가면 지어내기로 센다
    add_case(root, "notes", "c1", "DECISION_LEAK", absent_in={"decisions": ["휴교"]})
    code, result = evaluate(root, capsys)
    assert code == 1
    notes = skill_result(result, "notes")
    assert notes["fabrications"] == 3
    cases = notes["cases"]
    assert isinstance(cases, list)
    assert "decisions에 나오면 안 되는 내용: 휴교" in cases[0]["problems"]


def test_field_scoped_absent_ignores_other_fields(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    # 요약에서 "휴교는 하지 않기로 함"이라고 쓰는 것은 올바른 답이다
    add_case(root, "notes", "c1", "SUMMARY_MENTION", absent_in={"decisions": ["휴교"]})
    code, result = evaluate(root, capsys)
    assert code == 0
    assert skill_result(result, "notes")["fabrications"] == 0


def test_runner_failure_fails_the_run_instead_of_crashing(
    root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    add_case(root, "notes", "c1", "회의록 1")
    add_case(root, "notes", "c2", "CRASH")
    code, result = evaluate(root, capsys)
    assert code == 1
    cases = skill_result(result, "notes")["cases"]
    assert isinstance(cases, list)
    assert cases[0]["passed_runs"] == 3
    assert cases[1]["passed_runs"] == 0
    assert any("실행기 오류" in p and "exit 1" in p for p in cases[1]["problems"])


def test_no_cases_is_an_error(root: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = eval_skills.main([], root=root)
    assert code == 2
    assert "평가 케이스" in capsys.readouterr().out
