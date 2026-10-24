# 제품 스킬

Randomy가 모델을 부를 때 쓰는 스킬을 둔다. 백엔드 런타임(`randomy.skill_cli` 등)과 평가(`scripts/eval_skills.py`)만 읽는다.

- 위치: `skills/<이름>/`
  - `SKILL.md`: 지시문 (모델에 보내는 system 지시)
  - 결정적 스크립트·출력 스키마: 같은 폴더에 두고 `backend/tests`에서 TDD로 검증한다
- `.claude/skills/`에 두지 않는다. 이 레포에서 일하는 팩토리 세션이 만들고 있는 제품 스킬을 자기 지시문으로 읽게 되기 때문이다 (기획안 12.1 조건 2).
- `skills/` 변경은 MEDIUM이다. `make eval-skills` PASS 기록이 있어야 승인 대기에 오르고, 사람 승인 후 머지한다.
