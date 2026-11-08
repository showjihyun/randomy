# Randomy 디자인 기준 (DESIGN.md)

> 화면 작업의 기준 문서다 (팩토리 기획안 5.1, factory-v10). 사람이 승인해 커밋하며, 잠금·HIGH라 팩토리 작업은 따르기만 한다. 바꿀 때는 사람이 고치고 다시 승인한다.

## 0. 디자인 원본

- 사용자가 준 디자인 URL이 없으므로 **shadcn/ui 기본 테마(neutral)** 를 기준으로 한다 (https://ui.shadcn.com/docs/theming).
- 성격: 개인 업무 도구. 차분하고 정보가 빽빽해도 읽기 쉬운 화면. 장식보다 여백·위계·정렬로 구분한다.

## 1. 기술 기준

| 항목 | 기준 |
|---|---|
| 스타일 | Tailwind CSS v4 (`@tailwindcss/vite`), `src/index.css`에 `@import "tailwindcss"`와 아래 토큰 |
| 컴포넌트 | shadcn/ui, `src/components/ui/`. 경로 별칭 `@/*` → `src/*` (`tsconfig.json`, `vite.config.ts`) |
| 아이콘 | lucide-react, 크기 `size-4` (버튼 안), `size-5` (탐색) |
| 클래스 합치기 | `cn()` (`src/lib/utils.ts`) |
| 다크 모드 | `prefers-color-scheme: dark`면 `<html class="dark">` (설정 화면 없음) |

## 2. 토큰

shadcn/ui neutral 기본값을 그대로 쓴다. 화면 코드는 토큰 클래스(`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`)만 쓰고 `#hex`·`rgb()`·인라인 style을 쓰지 않는다.

| 토큰 | 라이트 | 다크 |
|---|---|---|
| `--background` / `--foreground` | `oklch(1 0 0)` / `oklch(0.145 0 0)` | `oklch(0.145 0 0)` / `oklch(0.985 0 0)` |
| `--card` / `--card-foreground` | `oklch(1 0 0)` / `oklch(0.145 0 0)` | `oklch(0.205 0 0)` / `oklch(0.985 0 0)` |
| `--primary` / `--primary-foreground` | `oklch(0.205 0 0)` / `oklch(0.985 0 0)` | `oklch(0.922 0 0)` / `oklch(0.205 0 0)` |
| `--secondary` / `--secondary-foreground` | `oklch(0.97 0 0)` / `oklch(0.205 0 0)` | `oklch(0.269 0 0)` / `oklch(0.985 0 0)` |
| `--muted` / `--muted-foreground` | `oklch(0.97 0 0)` / `oklch(0.556 0 0)` | `oklch(0.269 0 0)` / `oklch(0.708 0 0)` |
| `--accent` / `--accent-foreground` | `oklch(0.97 0 0)` / `oklch(0.205 0 0)` | `oklch(0.269 0 0)` / `oklch(0.985 0 0)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |
| `--border` / `--input` / `--ring` | `oklch(0.922 0 0)` / `oklch(0.922 0 0)` / `oklch(0.708 0 0)` | `oklch(1 0 0 / 10%)` / `oklch(1 0 0 / 15%)` / `oklch(0.556 0 0)` |
| `--sidebar` / `--sidebar-foreground` | `oklch(0.985 0 0)` / `oklch(0.145 0 0)` | `oklch(0.205 0 0)` / `oklch(0.985 0 0)` |
| `--radius` | `0.625rem` | |

## 3. 글자·간격·배치

- 글꼴: `"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif` (웹 글꼴은 받지 않는다. 설치돼 있으면 쓴다).
- 크기: 앱 이름 `text-lg font-semibold`, 화면 제목(h2) `text-2xl font-semibold tracking-tight`, 구역 제목(h3) `text-base font-semibold`, 본문 `text-sm`, 날짜·보조 `text-xs text-muted-foreground`. 노트 본문은 `leading-7`, 줄바꿈 유지(`whitespace-pre-wrap`).
- 간격: Tailwind 4px 눈금만. 화면 안 구역 사이 `gap-6`, 카드 안쪽 `p-6`(목록 행은 `p-4`), 폼 필드 사이 `gap-4`.
- 배치 (앱 껍데기):
  - **1024px 이상**: 왼쪽 탐색 바(폭 `w-56`, `bg-sidebar`, 오른쪽 `border-r`) + 본문(`max-w-4xl`, 가운데, `px-8 py-8`). 탐색 바 위쪽에 앱 이름과 한 줄 설명(`text-xs text-muted-foreground`), 아래로 탭 4개.
  - **1024px 미만**: 위쪽 헤더(앱 이름) + 그 아래 가로 탭 줄(가로 스크롤 없이 4개가 한 줄, 아이콘 + 짧은 이름). 본문 `px-4 py-6`.
  - 360px 폭에서 가로 스크롤이 없어야 한다.
- 상태 문구(`role="status"`)는 본문 위 한 줄, `text-sm text-muted-foreground`. 비어 있으면 자리를 차지하지 않는다.
- 줄바꿈 (v2): 한국어는 단어 중간에서 끊지 않는다. `body`에 `break-keep`(word-break: keep-all)을 전역으로 걸고, 긴 영문·URL이 들어갈 수 있는 곳(노트 본문, 원문)은 `break-words`를 더한다.
- 날짜 (v2): 저장 형식(ISO, UTC)은 그대로 두고 화면에서만 로컬 시간으로 바꿔 보여 준다. 형식은 `Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" })` (예: `2026. 11. 8. 오후 5:20`), 공통 함수 `src/lib/format.ts`의 `formatDateTime`. `<time dateTime>` 속성에는 ISO 원문을 둔다. 날짜만 필요한 곳(주간 범위, 할 일 기한)은 `dateStyle: "medium"`.
- 카드 여백 (v2): 목록을 담는 `Card`는 위아래 여백을 행이 갖는다. `Card`에 `py-0`(또는 `gap-0`)을 주고 행이 `px-4 py-3`을 가진다. 제목이 있는 카드만 `CardHeader`의 기본 여백을 쓴다.
- 2열 표 (v2): 제목과 보조 글을 나란히 둘 때 제목 칸은 줄어들지 않게(`shrink-0`, 최소 `min-w-32`) 하고 보조 글이 줄어든다. 좁으면(sm 미만) 위아래로 쌓는다.

## 4. 컴포넌트 대응

**테스트 호환 규칙 (중요)**: 지금 수락 테스트는 화면 요소를 역할·이름으로 찾는다. 모양만 바꾸고 **역할(button, textbox, checkbox, status, alert, region)과 접근 가능한 이름(버튼 글자, aria-label, label 글자)은 그대로** 둔다. 예: 상단 탭은 `role="tab"`으로 바꾸지 않고 버튼으로 둔다 (`Button` + 선택 표시 `aria-current="page"`).

| 화면 요소 | 컴포넌트 | 규칙 |
|---|---|---|
| 탭 4개 (노트, 할 일, 찾기, 주간 정리) | `Button variant="ghost"`, 선택된 탭은 `bg-accent text-accent-foreground font-medium` + `aria-current="page"` | 아이콘: `NotebookPen`, `ListTodo`, `Search`, `CalendarRange` |
| 주 동작 (저장, 정리, 검색, 질문) | `Button` (default) | 화면 구역마다 하나 |
| 보조 동작 (새 노트, 취소, 목록으로, 원본 노트, 다시 시도, 추가) | `Button variant="outline"` 또는 `"ghost"`, 작은 곳은 `size="sm"` | |
| 줄 삭제 (결정·할 일 빼기) | `Button variant="ghost" size="sm"`, 글자 유지 | 위험 색은 쓰지 않는다 (되돌릴 수 있는 편집) |
| 입력 | `Input`, `Textarea`, `Label` | 보이는 라벨이 있는 곳은 `Label`, 지금 `aria-label`만 있는 곳은 그대로 |
| 노트·결과 목록 | `Card` 안 목록, 행은 `hover:bg-accent` 버튼 | 행: 제목(`font-medium`) + 오른쪽 날짜(`text-xs text-muted-foreground`) |
| 할 일 | 행마다 체크박스(지금 `input type="checkbox"` 유지 또는 shadcn `Checkbox`, 테스트가 통과하는 쪽) + 할 일 + `Badge variant="secondary"`(담당, 기한) + `원본 노트` ghost 버튼 | 완료는 `line-through text-muted-foreground` |
| 정리 결과 편집 | `Card` 하나: 제목·요약 → `Separator` → 결정 사항 목록 → 할 일 목록(할 일·담당·기한 3칸, 좁으면 세로) → 저장 | |
| 답변 (찾기) | `Card`, 본문 아래 "근거" 줄에 근거 노트 버튼(`Button variant="outline" size="sm"`) | 근거 없음 답은 `text-muted-foreground` |
| 주간 정리 | 위에 주 이동(`이전 주`·`다음 주` outline + 가운데 기간 글자), 아래 `Card` 3개(이번 주 노트, 결정 사항, 남은 할 일) | 1024px 이상에서 노트·결정은 2열 |
| 오류 | `Alert variant="destructive"` (`role="alert"` 유지) + 다시 시도 버튼 | |
| 빈 목록 | 점선 테두리 영역(`border border-dashed rounded-lg p-8 text-center`) + 설명 + 다음 동작 버튼 | 문구는 지금 그대로 ("저장된 노트가 없습니다" 등) |
| 로딩 | `Skeleton` 3줄, 버튼은 `disabled` + `Loader2 animate-spin` | |

## 5. 상태

모든 화면: 빈 목록, 로딩, 오류(다시 시도), 요청 중(버튼 막기). 문구는 지금 화면의 문구를 그대로 쓴다.

## 6. 접근성

- 포커스 링(`focus-visible:ring-[3px] ring-ring/50`, shadcn 기본)을 지우지 않는다. 본문 대비 WCAG AA.
- 키보드만으로 탭 이동·저장·검색이 된다. 아이콘만 있는 버튼은 만들지 않는다 (글자 유지).

## 7. 화면 목록

| 화면 | 목적 | 배치 |
|---|---|---|
| 노트 목록 | 저장한 노트 보기, 새 노트·정리 시작 | 제목 "노트" + 오른쪽 `새 노트`(outline)·`정리`(default) → 노트 목록 Card |
| 노트 작성 | 직접 쓴 노트 저장 | Card: 제목 Input, 본문 Textarea(`min-h-48`), 아래 오른쪽 `취소`·`저장` |
| 노트 상세 | 노트 읽기 | 제목(h2) + 날짜 → 본문 Card → `목록으로` |
| 정리 | 원문 붙여넣기 → 정리 결과 확인·수정 → 저장 | 원문 Textarea(`min-h-56`) + `정리` → 결과 편집 Card (위 4장) |
| 할 일 | 추출된 할 일 처리 | 제목 "할 일" → 할 일 목록 Card (미완료 먼저는 범위 밖, 지금 순서 유지) |
| 찾기 | 검색과 근거 붙은 질문 | 검색 폼(Input + `검색`)과 질문 폼(Input + `질문`)을 Card 하나에 위아래로 → 결과(노트 결과, 결정 사항 결과) → 답변 Card |
| 주간 정리 | 이번 주 요약 | 주 이동 → Card 3개 |

## 8. 승인

- 초안: AI(상위 세션), 2026-11-08. 승인: 레포 소유자, 2026-11-08.
- v2 (2026-11-08): 화면 확인(P003) 뒤 보강: 한국어 줄바꿈, 날짜 표시 형식, 목록 카드 여백, 2열 표. 승인: 레포 소유자, 2026-11-08.
