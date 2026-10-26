"""백엔드와 프론트엔드를 함께 띄우는 실행기."""

import argparse
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from collections.abc import Callable
from pathlib import Path
from typing import Any

HEALTH_URL = "http://localhost:8000/api/health"
APP_URL = "http://localhost:5173"
DEFAULT_MODEL = "claude-cli:sonnet"


def find_executable(name: str, path: str | None = None) -> str | None:
    """PATH에서 실행 파일을 찾는다. Windows는 PATHEXT 확장자를 먼저 시도한다."""
    search = os.environ.get("PATH", "") if path is None else path
    exts: list[str] = [""]
    if os.name == "nt":
        pathext = os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD")
        exts = [e for e in pathext.split(";") if e] + [""]
    for directory in search.split(os.pathsep):
        if not directory:
            continue
        for ext in exts:
            candidate = Path(directory) / (name + ext)
            if candidate.is_file():
                return str(candidate)
    return None


def _default_spawn(args: list[str], cwd: Path, env: dict[str, str]) -> Any:
    return subprocess.Popen(args, cwd=str(cwd), env=env)


def _default_stop(proc: Any) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
            capture_output=True,
            check=False,
        )
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def _default_wait_health(url: str = HEALTH_URL, timeout: float = 60.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):  # noqa: S310
                return True
        except Exception:
            time.sleep(1)
    return False


def main(
    argv: list[str] | None = None,
    *,
    spawn: Callable[[list[str], Path, dict[str, str]], Any] = _default_spawn,
    stop: Callable[[Any], None] = _default_stop,
    open_browser: Callable[[str], Any] = webbrowser.open,
    wait_health: Callable[..., bool] = _default_wait_health,
) -> int:
    parser = argparse.ArgumentParser(prog="randomy.launcher")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--model", default=None)
    opts = parser.parse_args(argv)

    root = Path(__file__).resolve().parents[3]
    env = dict(os.environ)
    env["RANDOMY_MODEL"] = opts.model or env.get("RANDOMY_MODEL") or DEFAULT_MODEL

    uv = find_executable("uv") or "uv"
    npm = find_executable("npm") or "npm"
    jobs: list[tuple[list[str], Path]] = [
        (
            [
                uv,
                "run",
                "uvicorn",
                "randomy.main:app_from_env",
                "--factory",
                "--app-dir",
                "src",
                "--port",
                "8000",
            ],
            root / "backend",
        ),
        (
            [npm, "run", "dev", "--", "--port", "5173", "--strictPort"],
            root / "frontend",
        ),
    ]

    procs: list[Any] = []
    for args, cwd in jobs:
        try:
            procs.append(spawn(args, cwd, env))
        except Exception as exc:
            print(f"실행 실패: {args[0]}: {exc}", file=sys.stderr)
            for p in procs:
                stop(p)
            return 1

    try:
        if wait_health():
            if not opts.no_browser:
                open_browser(APP_URL)
        else:
            print("경고: 백엔드가 60초 안에 응답하지 않았습니다.", file=sys.stderr)
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            stop(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
