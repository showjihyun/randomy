import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Weekly from "./Weekly";

const PERIOD = "2026-10-19 ~ 2026-10-25";
const LIST_SECTIONS = ["이번 주 노트", "결정 사항"];
const TITLE_CLASSES = ["shrink-0", "min-w-32", "font-medium", "max-w-full", "sm:max-w-1/2"];
const SECONDARY_CLASSES = ["text-muted-foreground", "flex-1", "min-w-0"];
const ROW_CLASSES = ["flex-col", "sm:flex-row", "items-start", "px-4", "py-3"];

const created = "2026-10-20T09:00:00+00:00";

const filledWeek = {
  start: "2026-10-19",
  end: "2026-10-25",
  notes: [
    { id: 1, title: "주간 회의", summary: "배포 일정 논의", created_at: created },
    { id: 2, title: "아이디어 메모", summary: null, created_at: created },
  ],
  decisions: [
    { id: 7, note_id: 1, note_title: "주간 회의", text: "금요일에 배포한다", created_at: created },
  ],
  open_todos: [
    {
      id: 3,
      note_id: 1,
      task: "배포 공지 쓰기",
      owner: "민수",
      due: "2026-10-23",
      done: false,
      created_at: created,
    },
    {
      id: 4,
      note_id: 2,
      task: "화면 스케치",
      owner: null,
      due: null,
      done: false,
      created_at: created,
    },
  ],
};

const emptyWeek = { start: "2026-10-19", end: "2026-10-25", notes: [], decisions: [], open_todos: [] };

function stubWeek(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

async function renderLoaded(data: unknown) {
  stubWeek(data);
  render(<Weekly onOpenNote={vi.fn()} />);
  // findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
  await waitFor(() => expect(screen.queryByText(PERIOD)).not.toBeNull());
}

function region(name: string): HTMLElement {
  return screen.queryByRole("region", { name }) as HTMLElement;
}

function rowsOf(name: string): HTMLElement[] {
  return within(region(name)).queryAllByRole("button");
}

function cardOf(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>('[data-slot="card"]');
}

// jest-dom 매처의 실패는 assertion 실패로 집계되지 않으므로 값을 꺼내 expect로 비교한다.
function classesOf(element: Element | null | undefined): string[] {
  return Array.from(element?.classList ?? []);
}

// from부터 Card 바로 안쪽까지의 요소가 가진 클래스를 모은다 (Card 자신은 뺀다).
function classesInsideCard(from: Element | null | undefined): string[] {
  const classes: string[] = [];
  let node: Element | null = from ?? null;
  while (node !== null && node.getAttribute("data-slot") !== "card") {
    classes.push(...classesOf(node));
    node = node.parentElement;
  }
  return classes;
}

function hasSpacing(classes: string[], pattern: RegExp): boolean {
  return classes.some((name) => pattern.test(name));
}

function expectTwoColumnRow(row: HTMLElement | undefined, title: string, secondary: string) {
  expect(classesOf(row)).toEqual(expect.arrayContaining(ROW_CLASSES));
  const scope = within(row as HTMLElement);
  expect(classesOf(scope.queryByText(title))).toEqual(expect.arrayContaining(TITLE_CLASSES));
  expect(classesOf(scope.queryByText(secondary))).toEqual(
    expect.arrayContaining(SECONDARY_CLASSES),
  );
}

describe("J028 주간 정리 행의 2열 표와 카드 여백", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'이번 주 노트' 행은 제목이 줄지 않는 2열이고 버튼 이름은 그대로다", async () => {
    await renderLoaded(filledWeek);

    const [row] = rowsOf("이번 주 노트");
    expectTwoColumnRow(row, "주간 회의", "배포 일정 논의");
    expect(
      within(region("이번 주 노트")).queryByRole("button", { name: "주간 회의 배포 일정 논의" }),
    ).toBe(row);
  });

  it("요약이 없는 노트 행은 제목만 있고 보조 글 요소가 없다", async () => {
    await renderLoaded(filledWeek);

    const row = rowsOf("이번 주 노트")[1];
    expect(classesOf(row)).toEqual(expect.arrayContaining(ROW_CLASSES));
    expect(classesOf(within(row).queryByText("아이디어 메모"))).toEqual(
      expect.arrayContaining(TITLE_CLASSES),
    );
    expect(row.querySelectorAll(".text-muted-foreground")).toHaveLength(0);
  });

  it("'결정 사항' 행은 결정 문구가 줄지 않는 2열이고 버튼 이름은 그대로다", async () => {
    await renderLoaded(filledWeek);

    const [row] = rowsOf("결정 사항");
    expectTwoColumnRow(row, "금요일에 배포한다", "주간 회의");
    expect(
      within(region("결정 사항")).queryByRole("button", { name: "금요일에 배포한다 주간 회의" }),
    ).toBe(row);
  });

  it("두 구역의 Card는 py-0 gap-0이고 행은 px-0 CardContent의 divide-y 목록 안에 있다", async () => {
    await renderLoaded(filledWeek);

    for (const name of LIST_SECTIONS) {
      const [row] = rowsOf(name);
      expect(classesOf(cardOf(row))).toEqual(expect.arrayContaining(["py-0", "gap-0"]));
      expect(classesOf(row.closest('[data-slot="card-content"]'))).toContain("px-0");
      expect(region(name).contains(row.closest(".divide-y"))).toBe(true);
      expect(row.closest(".divide-y")).not.toBeNull();
    }
  });

  it("두 구역의 머리글은 Card py-0 안에서 위 여백을 갖는다", async () => {
    await renderLoaded(filledWeek);

    for (const name of LIST_SECTIONS) {
      const heading = within(region(name)).queryByRole("heading", { level: 2, name });
      const header = heading?.closest('[data-slot="card-header"]');
      expect(classesOf(cardOf(heading as HTMLElement))).toContain("py-0");
      expect(hasSpacing(classesInsideCard(header), /^(p|pt|py)-[1-9]/)).toBe(true);
    }
  });

  it("두 구역의 '없음' 점선 영역은 Card py-0 안에서 가로·아래 여백을 갖는다", async () => {
    await renderLoaded(emptyWeek);

    for (const name of LIST_SECTIONS) {
      const dashed = within(region(name)).queryByText("없음")?.closest(".border-dashed");
      expect(classesOf(cardOf(dashed as Element))).toContain("py-0");
      const around = classesInsideCard(dashed?.parentElement);
      expect(hasSpacing(around, /^(p|px)-[1-9]/)).toBe(true);
      expect(hasSpacing(around, /^(p|pb|py)-[1-9]/)).toBe(true);
    }
  });

  it("남은 할 일의 담당·기한은 secondary Badge에 글자 그대로 있고, 값이 없으면 Badge가 없다", async () => {
    await renderLoaded(filledWeek);

    const [withValues, withoutValues] = within(region("남은 할 일")).queryAllByRole("listitem");
    const badges = Array.from(withValues.querySelectorAll('[data-slot="badge"]'));
    expect(badges.map((badge) => badge.textContent?.trim())).toEqual([
      "담당: 민수",
      "기한: 2026-10-23",
    ]);
    expect(badges.map((badge) => badge.getAttribute("data-variant"))).toEqual([
      "secondary",
      "secondary",
    ]);
    expect(withoutValues.querySelectorAll('[data-slot="badge"]')).toHaveLength(0);
  });
});
