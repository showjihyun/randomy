import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "./api";
import App from "./App";

type DueStatus = "overdue" | "today" | "soon" | null;
type DueModule = { dueStatus: (dueDate: string | null, done: boolean, today: string) => DueStatus };

// 정적 import는 모듈이 없을 때 assertion이 아닌 오류가 되므로 glob으로 읽는다.
const dueModules = import.meta.glob<DueModule>("./lib/due.ts", { eager: true });

const TODAY = "2026-11-08";
const TABS: [string, string][] = [
  ["노트", "lucide-notebook-pen"],
  ["할 일", "lucide-list-todo"],
  ["찾기", "lucide-search"],
  ["주간 정리", "lucide-calendar-range"],
  ["캘린더", "lucide-calendar-days"],
];
const TAB_CLASSES = ["text-xs", "lg:text-sm", "flex-col", "sm:flex-row", "h-auto", "sm:h-8"];

const STATUS_CASES: [string | null, boolean, string, DueStatus][] = [
  ["2026-11-07", false, TODAY, "overdue"],
  ["2025-11-08", false, TODAY, "overdue"],
  ["2026-11-08", false, TODAY, "today"],
  ["2026-11-09", false, TODAY, "soon"],
  ["2026-11-11", false, TODAY, "soon"],
  ["2026-11-12", false, TODAY, null],
  ["2026-11-07", true, TODAY, null],
  ["2026-11-08", true, TODAY, null],
  ["2026-11-11", true, TODAY, null],
  [null, false, TODAY, null],
  [null, true, TODAY, null],
  // 달·연 경계
  ["2026-12-03", false, "2026-11-30", "soon"],
  ["2026-12-04", false, "2026-11-30", null],
  ["2027-01-01", false, "2026-12-31", "soon"],
  ["2026-12-31", false, "2027-01-01", "overdue"],
  // 서머타임 경계 (로컬 자정끼리 빼면 한 시간이 모자라거나 남는다)
  ["2026-11-03", false, "2026-10-31", "soon"],
  ["2026-03-10", false, "2026-03-07", "soon"],
  ["2026-03-11", false, "2026-03-07", null],
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTodo(id: number, task: string, due: string | null, dueDate: string | null, done = false): Todo {
  return {
    id,
    note_id: 2,
    task,
    owner: null,
    due,
    due_date: dueDate,
    done,
    created_at: "2026-11-01T09:00:00+00:00",
  };
}

function stubApi(todos: Todo[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/notes") {
      return json([]);
    }
    if (path === "/api/todos") {
      return json(todos);
    }
    if (path === "/api/calendar") {
      return json({ month: "2026-11", days: [] });
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForElement(query: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(query()).not.toBeNull());
  return query() as HTMLElement;
}

function button(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  await waitForElement(() => screen.queryByText("서버 연결됨 (모델: fake)"));
  return user;
}

async function renderTodos(todos: Todo[]) {
  stubApi(todos);
  const user = await renderApp();
  await user.click(button("할 일") as HTMLElement);
  await waitForElement(() => screen.queryByText(todos[0].task));
}

function rowOf(task: string): HTMLElement {
  return screen.queryByText(task)?.closest("li") as HTMLElement;
}

// 담당·기한 원문을 뺀 배지가 상태 배지다.
function statusBadges(row: HTMLElement): Element[] {
  return Array.from(row.querySelectorAll('[data-slot="badge"]')).filter((badge) => {
    const text = badge.textContent ?? "";
    return !text.startsWith("담당:") && !text.startsWith("기한:");
  });
}

function expectStatusBadge(row: HTMLElement, label: string, variant: string) {
  const badges = statusBadges(row);
  expect(badges.map((badge) => badge.textContent)).toEqual([label]);
  expect(badges[0].getAttribute("data-variant")).toBe(variant);
}

function expectBesideOriginal(row: HTMLElement, due: string) {
  const original = within(row).queryByText(`기한: ${due}`);
  expect(original?.getAttribute("data-slot")).toBe("badge");
  expect(original?.getAttribute("data-variant")).toBe("secondary");
  expect(original?.nextElementSibling).toBe(statusBadges(row)[0]);
}

function expectNoStatusBadge(row: HTMLElement) {
  expect(statusBadges(row).map((badge) => badge.textContent)).toEqual([]);
}

function classesOf(element: Element | null | undefined): string[] {
  return Array.from(element?.classList ?? []);
}

describe("J034 dueStatus", () => {
  it.each(STATUS_CASES)("dueStatus(%s, %s, %s)는 %s다", (dueDate, done, today, expected) => {
    const dueStatus = dueModules["./lib/due.ts"]?.dueStatus;
    expect(typeof dueStatus).toBe("function");

    expect(dueStatus(dueDate, done, today)).toBe(expected);
  });
});

describe("J034 할 일 마감 표시", () => {
  beforeEach(() => {
    // 타이머는 진짜로 두고 Date만 고정한다 (waitFor와 userEvent가 진짜 타이머를 쓴다).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 8, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("기한 지난 미완료 할 일은 원문 배지 옆에 destructive '기한 지남'이 있고 원문은 그대로다", async () => {
    await renderTodos([makeTodo(1, "지난 일", "금요일", "2026-11-07")]);

    const row = rowOf("지난 일");
    expectStatusBadge(row, "기한 지남", "destructive");
    expectBesideOriginal(row, "금요일");
  });

  it("기한이 오늘인 미완료 할 일은 default '오늘'이다", async () => {
    await renderTodos([makeTodo(1, "오늘 일", "오늘까지", TODAY)]);

    const row = rowOf("오늘 일");
    expectStatusBadge(row, "오늘", "default");
    expectBesideOriginal(row, "오늘까지");
  });

  it("1일 뒤와 3일 뒤의 미완료 할 일은 outline '곧'이다", async () => {
    await renderTodos([
      makeTodo(1, "내일 일", "내일", "2026-11-09"),
      makeTodo(2, "사흘 뒤 일", "수요일", "2026-11-11"),
    ]);

    expectStatusBadge(rowOf("내일 일"), "곧", "outline");
    expectBesideOriginal(rowOf("내일 일"), "내일");
    expectStatusBadge(rowOf("사흘 뒤 일"), "곧", "outline");
    expectBesideOriginal(rowOf("사흘 뒤 일"), "수요일");
  });

  it("4일 뒤, 완료, due_date 없는 할 일에는 상태 배지가 없고 원문 배지는 남는다", async () => {
    await renderTodos([
      makeTodo(1, "지난 일", "금요일", "2026-11-07"),
      makeTodo(2, "먼 일", "목요일", "2026-11-12"),
      makeTodo(3, "끝낸 일", "어제", "2026-11-07", true),
      makeTodo(4, "모호한 일", "언젠가", null),
    ]);

    expectStatusBadge(rowOf("지난 일"), "기한 지남", "destructive");
    expectNoStatusBadge(rowOf("먼 일"));
    expectNoStatusBadge(rowOf("끝낸 일"));
    expectNoStatusBadge(rowOf("모호한 일"));
    expect(within(rowOf("끝낸 일")).queryByText("기한: 어제")).not.toBeNull();
    expect(within(rowOf("모호한 일")).queryByText("기한: 언젠가")).not.toBeNull();
  });

  it.each([
    ["00:30", 0, 30],
    ["23:30", 23, 30],
  ])("로컬 %s에도 오늘은 로컬 날짜다", async (_label, hour, minute) => {
    vi.setSystemTime(new Date(2026, 10, 8, hour, minute));

    await renderTodos([
      makeTodo(1, "어제 일", "어제", "2026-11-07"),
      makeTodo(2, "오늘 일", "오늘까지", TODAY),
      makeTodo(3, "내일 일", "내일", "2026-11-09"),
    ]);

    expectStatusBadge(rowOf("어제 일"), "기한 지남", "destructive");
    expectStatusBadge(rowOf("오늘 일"), "오늘", "default");
    expectStatusBadge(rowOf("내일 일"), "곧", "outline");
  });
});

describe("J034 좁은 화면", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 8, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("탭 버튼 5개의 이름·순서·아이콘은 그대로이고 좁은 화면 클래스를 갖는다", async () => {
    stubApi([]);
    await renderApp();

    const row = button("노트")?.parentElement;
    const tabs = Array.from(row?.querySelectorAll("button") ?? []);
    expect(tabs.map((tab) => tab.textContent)).toEqual(TABS.map(([name]) => name));
    TABS.forEach(([, icon], index) => {
      expect(tabs[index].querySelector(`svg.${icon}`)).not.toBeNull();
    });
    for (const tab of tabs) {
      expect(classesOf(tab)).toEqual(expect.arrayContaining(TAB_CLASSES));
    }
  });

  it("캘린더 월 제목은 줄바꿈하지 않고 제목 모양은 그대로다", async () => {
    stubApi([]);
    const user = await renderApp();
    await user.click(button("캘린더") as HTMLElement);

    const title = await waitForElement(() =>
      screen.queryByRole("heading", { name: "2026년 11월", level: 2 }),
    );
    expect(classesOf(title)).toEqual(
      expect.arrayContaining(["whitespace-nowrap", "text-lg", "font-semibold"]),
    );
  });
});
