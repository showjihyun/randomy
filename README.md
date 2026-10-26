# Randomy

회의록·메모를 넣으면 요약·결정 사항·할 일로 정리해 두고, 나중에 "그때 뭐 정했지?"에 근거와 함께 답해 주는 개인 업무 보조 Agent.

- 사용자 1명, 내 PC에서만 실행 (로컬 SQLite). 요약·답변을 만들 때만 모델 API를 부른다.
- 개인용 AI SW Factory([EIFactory](https://github.com/showjihyun/EIFactory))로 만든다. 팩토리 엔진은 `factory/kit.lock`의 태그(`factory-v1`)로 고정돼 있다.

## 범위 (1차)

| 흐름 | 내용 |
|---|---|
| F1 정리 | 회의록·메모 → 요약, 결정 사항, 할 일. 확인·수정 후 저장 |
| F2 할 일 | 추출한 할 일 목록, 완료, 원본 노트로 이동 |
| F3 찾기 | 노트·결정 검색, 근거 노트를 붙인 답변 (근거 없으면 "없음") |
| F4 주간 정리 | 이번 주 노트·결정·남은 할 일 요약 |

## 구조

| 경로 | 내용 |
|---|---|
| `backend/` | FastAPI (Python 3.12, uv, pytest, ruff, mypy). 패키지 `randomy` |
| `frontend/` | React + TypeScript (Vite, Vitest, ESLint, Playwright) |
| `skills/` | 제품 스킬 (지시문, 스크립트, 출력 스키마) |
| `evals/skills/` | 스킬 평가 케이스 (사람이 작성·승인) |
| `scripts/` | 검증 계약(`verify.py`, `check_red.py`, `check_style.py`), 스킬 평가(`eval_skills.py`), 팩토리 shim |
| `factory/` | 팩토리 설정·절차 |

## 명령

Windows 호스트에는 make가 없으므로 같은 스크립트를 `python`으로 직접 실행해도 된다.

```
make setup            # cd backend && uv sync; cd frontend && npm ci
make verify           # python scripts/verify.py
make eval-skills      # python scripts/eval_skills.py (모델 호출, 비용 발생)
make dev-backend      # http://localhost:8000
make dev-frontend     # http://localhost:5173
start.cmd             # Windows: 백엔드+프론트엔드를 띄우고 브라우저를 연다 (기본 모델 claude-cli:sonnet)
start.cmd --no-browser --model fake   # 브라우저 없이, 모델 지정
```

모델은 `RANDOMY_MODEL`(기본 `fake`)로 고른다. 실제 모델 연결 전에는 가짜 모델로 돈다.

## 라이선스

MIT
