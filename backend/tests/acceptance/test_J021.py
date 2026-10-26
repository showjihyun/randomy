"""J021 실행기 수락 테스트. 실제 서버·브라우저를 띄우지 않고 모델도 부르지 않는다."""

import importlib
import importlib.util
import os
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]

BACKEND_ARGS = [
    "run",
    "uvicorn",
    "randomy.main:app_from_env",
    "--factory",
    "--app-dir",
    "src",
    "--port",
    "8000",
]
FRONTEND_ARGS = ["run", "dev", "--", "--port", "5173", "--strictPort"]


def _launcher() -> ModuleType:
    assert importlib.util.find_spec("randomy.launcher") is not None, (
        "randomy.launcher 모듈이 없습니다"
    )
    return importlib.import_module("randomy.launcher")


class FakeProc:
    def __init__(self) -> None:
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        self.returncode = 0
        return 0

    def terminate(self) -> None:
        self.returncode = 1

    def kill(self) -> None:
        self.returncode = 1


class Recorder:
    """첫 실행(백엔드)은 가짜 프로세스, 두 번째 실행(프론트엔드)은 예외를 낸다."""

    def __init__(self) -> None:
        self.first = FakeProc()
        self.spawned: list[tuple[list[str], Path, dict[str, str]]] = []
        self.stopped: list[Any] = []
        self.opened: list[str] = []
        self.health_checks = 0

    def spawn(self, args: list[str], cwd: Path, env: dict[str, str]) -> FakeProc:
        self.spawned.append((list(args), Path(cwd), dict(env)))
        if len(self.spawned) == 1:
            return self.first
        raise OSError(193, "%1 is not a valid Win32 application")

    def stop(self, proc: Any) -> None:
        self.stopped.append(proc)

    def open_browser(self, url: str) -> None:
        self.opened.append(url)

    def wait_health(self, *args: Any, **kwargs: Any) -> bool:
        self.health_checks += 1
        return True


def _run(rec: Recorder, argv: list[str]) -> int:
    launcher = _launcher()
    result: int = launcher.main(
        argv,
        spawn=rec.spawn,
        stop=rec.stop,
        open_browser=rec.open_browser,
        wait_health=rec.wait_health,
    )
    return result


@pytest.mark.skipif(os.name != "nt", reason="Windows 전용 규칙")
def test_windows_prefers_pathext_over_bare_name(tmp_path: Path) -> None:
    launcher = _launcher()
    (tmp_path / "npm").write_text("#!/bin/sh\n", encoding="utf-8")
    (tmp_path / "npm.cmd").write_text("@echo off\n", encoding="utf-8")

    found = launcher.find_executable("npm", path=str(tmp_path))

    assert found is not None
    assert Path(found).name.lower() == "npm.cmd"
    assert Path(found).parent.resolve() == tmp_path.resolve()


def test_second_spawn_failure_stops_first_and_returns_1(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("RANDOMY_MODEL", raising=False)
    rec = Recorder()

    code = _run(rec, [])

    assert code == 1
    assert len(rec.spawned) == 2
    assert rec.stopped == [rec.first]
    assert rec.opened == []
    backend_args, backend_cwd, backend_env = rec.spawned[0]
    frontend_args, frontend_cwd, _ = rec.spawned[1]
    assert backend_args[1:] == BACKEND_ARGS
    assert backend_cwd.resolve() == (REPO_ROOT / "backend").resolve()
    assert frontend_args[1:] == FRONTEND_ARGS
    assert frontend_cwd.resolve() == (REPO_ROOT / "frontend").resolve()
    assert backend_env["RANDOMY_MODEL"] == "claude-cli:sonnet"
    captured = capsys.readouterr()
    assert (captured.out + captured.err).strip() != "", "오류를 알리지 않았습니다"


def test_existing_model_env_is_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RANDOMY_MODEL", "fake")
    rec = Recorder()

    assert _run(rec, ["--no-browser"]) == 1

    assert rec.spawned[0][2]["RANDOMY_MODEL"] == "fake"


def test_model_option_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RANDOMY_MODEL", "fake")
    rec = Recorder()

    assert _run(rec, ["--no-browser", "--model", "claude-cli:opus"]) == 1

    assert rec.spawned[0][2]["RANDOMY_MODEL"] == "claude-cli:opus"


def test_start_cmd_is_ascii_only() -> None:
    start_cmd = REPO_ROOT / "start.cmd"
    assert start_cmd.is_file(), "start.cmd가 없습니다"
    data = start_cmd.read_bytes()
    non_ascii = [i for i, b in enumerate(data) if b > 0x7F]
    assert non_ascii == [], f"ASCII가 아닌 바이트 위치: {non_ascii[:10]}"
    text = data.decode("ascii")
    assert "randomy.launcher" in text
    assert "%~dp0" in text


def test_gitattributes_has_cmd_crlf_rule() -> None:
    lines = (REPO_ROOT / ".gitattributes").read_text(encoding="utf-8").splitlines()
    assert "*.cmd text eol=crlf" in [line.strip() for line in lines]


def test_readme_mentions_start_cmd() -> None:
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert "start.cmd" in readme
