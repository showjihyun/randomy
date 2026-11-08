import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { CalendarResult, Todo } from "./api";
import App from "./App";

type CalendarModule = {
  default: ComponentType<{ onOpenNote: (id: number) => void }>;
  monthGrid: (month: string) => string[];
};
type ApiWithCalendar = { fetchCalendar?: (month?: string) => Promise<CalendarResult> };

// 정적 import는 모듈이 없을 때 assertion이 아닌 오류가 되므로 glob으로 읽는다.
const calendarModules = import.meta.glob<CalendarModule>("./Calendar.tsx", { eager: true });

// 날짜 칸이 많아 역할·이름 조회가 느리다.
vi.setConfig({ testTimeout: 20000 });

const CELL_NAME = /^\d{1,2}월 \d{1,2}일, 노트 \d+, 결정 \d+, 할 일 \d+$/;
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const NOV_8 = "11월 8일, 노트 1, 결정 1, 할 일 0";
const NOV_9 = "11월 9일, 노트 0, 결정 0, 할 일 0";
const NOV_13 = "11월 13일, 노트 0, 결정 0, 할 일 2";
const NOV_20 = "11월 20일, 노트 2, 결정 0, 할 일 0";
const DEC_1 = "12월 1일, 노트 0, 결정 0, 할 일 0";
const DEC_3_FILLED = "12월 3일, 노트 1, 결정 0, 할 일 0";
const DEC_3_EMPTY = "12월 3일, 노트 0, 결정 0, 할 일 0";
const EMPTY_DAY_TEXT = "이 날짜에 기록이 없습니다";
const DASHED = ["border", "border-dashed", "rounded-lg", "p-8", "text-center"];

const november: CalendarResult = {
  month: "2026-11",
  days: [
    {
      date: "2026-11-08",
      notes: [{ id: 1, title: "주간 회의" }],
      decisions: [{ text: "금요일에 배포한다", note_id: 7, note_title: "주간 회의" }],
      todos: [],
    },
    {
      date: "2026-11-13",
      notes: [],
      decisions: [],
      todos: [
        {
          id: 5,
          task: "배포 공지 쓰기",
          done: false,
          note_id: 3,
          due: "금요일",
          due_date: "2026-11-13",
        },
        {
          id: 6,
          task: "회고 정리",
          done: true,
          note_id: 4,
          due: "11월 13일",
          due_date: "2026-11-13",
        },
      ],
    },
    {
      date: "2026-11-20",
      notes: [
        { id: 8, title: "첫째 메모" },
        { id: 9, title: "둘째 메모" },
      ],
      decisions: [],
      todos: [],
    },
  ],
};

const december: CalendarResult = {
  month: "2026-12",
  days: [
    {
      date: "2026-12-03",
      notes: [{ id: 2, title: "12월 메모" }],
      decisions: [],
      todos: [],
    },
  ],
};

// 타입 표기가 Todo.due_date의 컴파일 확인이다 (verify.py의 타입체크).
const todoWithDueDate: Todo = {
  id: 5,
  note_id: 1,
  task: "배포 공지 쓰기",
  owner: null,
  due: "금요일",
  due_date: "2026-11-13",
  done: false,
  created_at: "2026-11-08T09:00:00+00:00",
};

const noteDetail = {
  id: 1,
  title: "주간 회의",
  body: "결정: 금요일에 배포",
  created_at: "2026-11-08T08:20:40+00:00",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): URL {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url, "http://localhost");
}

function stubCalendar(byMonth: Record<string, CalendarResult>) {
  const months: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const month = urlOf(input).searchParams.get("month");
      months.push(month);
      return json(byMonth[month ?? ""] ?? { month, days: [] });
    }),
  );
  return months;
}

type Pending = { month: string | null; resolve: (response: Response) => void };

function stubDeferred(): Pending[] {
  const pending: Pending[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          pending.push({ month: urlOf(input).searchParams.get("month"), resolve });
        }),
    ),
  );
  return pending;
}

function stubApp() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = urlOf(input).pathname;
      if (path === "/api/health") {
        return json({ status: "ok", model: "fake" });
      }
      if (path === "/api/notes") {
        return json([noteDetail]);
      }
      if (path === `/api/notes/${noteDetail.id}`) {
        return json(noteDetail);
      }
      if (path === "/api/todos") {
        return json([todoWithDueDate]);
      }
      if (path === "/api/calendar") {
        return json(november);
      }
      return json({ detail: "Not Found" }, 404);
    }),
  );
}

function loadCalendar(): CalendarModule {
  const module = calendarModules["./Calendar.tsx"];
  expect(module).toBeDefined();
  return module as CalendarModule;
}

function renderCalendar() {
  const { default: Calendar } = loadCalendar();
  const onOpenNote = vi.fn();
  render(<Calendar onOpenNote={onOpenNote} />);
  return { onOpenNote, user: userEvent.setup() };
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForElement(query: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(query()).not.toBeNull());
  return query() as HTMLElement;
}

function cell(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

function allCells(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: CELL_NAME });
}

function button(name: string): HTMLElement {
  return screen.queryByRole("button", { name }) as HTMLElement;
}

function heading(name: string): HTMLElement | null {
  return screen.queryByRole("heading", { name });
}

function region(name: string): HTMLElement | null {
  return screen.queryByRole("region", { name });
}

function rowIn(sectionName: string, name: RegExp): HTMLElement {
  return within(region(sectionName) as HTMLElement).queryByRole("button", {
    name,
  }) as HTMLElement;
}

async function renderLoaded(byMonth: Record<string, CalendarResult> = { "2026-11": november }) {
  const months = stubCalendar(byMonth);
  const rendered = renderCalendar();
  await waitForElement(() => heading("11월 8일 (일)"));
  await waitForElement(() => allCells()[0] ?? null);
  return { ...rendered, months };
}

// jest-dom 매처의 실패는 assertion 실패로 집계되지 않으므로 값을 꺼내 expect로 비교한다.
function classesOf(element: Element | null | undefined): string[] {
  return Array.from(element?.classList ?? []);
}

function classesWithin(element: Element | null | undefined): string[] {
  if (element === null || element === undefined) {
    return [];
  }
  return [element, ...Array.from(element.querySelectorAll("*"))].flatMap(classesOf);
}

function dotsIn(element: Element | null): Element[] {
  return Array.from(element?.querySelectorAll("*") ?? []).filter((child) =>
    child.classList.contains("size-1.5"),
  );
}

function skeletons(): Element[] {
  return Array.from(document.querySelectorAll('[data-slot="skeleton"]'));
}

function cardOf(element: Element | null): Element | null {
  return element?.closest('[data-slot="card"]') ?? null;
}

// 응답 본문 읽기가 끝날 시간을 준다. 실제 타이머라 가짜 Date와 충돌하지 않는다.
async function settle(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 8, 12, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("J033 monthGrid", () => {
  it.each([
    ["2026-11", "2026-10-26", "2026-12-06", 42],
    ["2026-03", "2026-02-23", "2026-04-05", 42],
    ["2026-02", "2026-01-26", "2026-03-01", 35],
    ["2026-06", "2026-06-01", "2026-07-05", 35],
    ["2027-02", "2027-02-01", "2027-02-28", 28],
    ["2028-02", "2028-01-31", "2028-03-05", 35],
    ["2026-12", "2026-11-30", "2027-01-03", 35],
  ])("%s는 %s부터 %s까지 %i일이다", (month, first, last, count) => {
    const grid = loadCalendar().monthGrid(month);

    expect(grid).toHaveLength(count);
    expect(grid[0]).toBe(first);
    expect(grid[grid.length - 1]).toBe(last);
  });

  it("날짜가 하루씩 이어지고 주 단위이며 그 달의 모든 날을 담는다", () => {
    const grid = loadCalendar().monthGrid("2026-03");

    expect(grid).toHaveLength(42);
    expect(grid.filter((date) => date.startsWith("2026-03"))).toHaveLength(31);
    expect(grid[0]).toBe("2026-02-23");
    const days = grid.map((date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8)));
    days.forEach((day, index) => {
      if (index > 0) {
        expect(day - days[index - 1]).toBe(86_400_000);
      }
    });
  });
});

describe("J033 fetchCalendar", () => {
  function loadFetchCalendar() {
    const fetchCalendar = (api as ApiWithCalendar).fetchCalendar;
    expect(fetchCalendar).toBeTypeOf("function");
    return fetchCalendar as NonNullable<ApiWithCalendar["fetchCalendar"]>;
  }

  it("month가 없으면 /api/calendar를, 있으면 month 쿼리를 부르고 본문을 돌려준다", async () => {
    const fetchCalendar = loadFetchCalendar();
    const fetchMock = vi.fn(async () => json(november));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchCalendar()).toEqual(november);
    await fetchCalendar("2026-12");

    expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "/api/calendar",
      "/api/calendar?month=2026-12",
    ]);
  });

  it("실패 응답이면 예외를 던진다", async () => {
    const fetchCalendar = loadFetchCalendar();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ detail: "bad" }, 500)),
    );

    await expect(fetchCalendar("2026-11")).rejects.toBeInstanceOf(Error);
  });
});

describe("J033 월 격자", () => {
  it("이번 달 제목과 월요일 시작 요일 머리글, 주 단위 날짜 칸을 그린다", async () => {
    const { months } = await renderLoaded();

    expect(months[0]).toBe("2026-11");
    const title = heading("2026년 11월");
    expect(classesOf(title)).toEqual(expect.arrayContaining(["text-lg", "font-semibold"]));

    const headers = screen.queryAllByText(/^[월화수목금토일]$/);
    expect(headers.map((header) => header.textContent)).toEqual(WEEKDAYS);
    expect(classesOf(headers[0])).toEqual(
      expect.arrayContaining(["text-xs", "text-muted-foreground"]),
    );

    const cells = allCells();
    expect(cells).toHaveLength(42);
    expect(cells[0].getAttribute("aria-label") ?? cells[0].textContent).toMatch(/^10월 26일/);
    expect(cells[41].getAttribute("aria-label") ?? cells[41].textContent).toMatch(/^12월 6일/);
    expect(cells[0].closest(".grid-cols-7")).not.toBeNull();
    expect(cardOf(cells[0])).not.toBeNull();
    expect(cardOf(cells[0])).toBe(cardOf(headers[0]));
  });

  it("날짜 칸 이름에 항목 개수가 있고 칸은 정해진 높이를 가진다", async () => {
    await renderLoaded();

    for (const name of [NOV_8, NOV_9, NOV_13, NOV_20]) {
      expect(cell(name)).not.toBeNull();
    }
    expect(classesOf(cell(NOV_9))).toEqual(expect.arrayContaining(["min-h-12", "lg:min-h-24"]));
  });

  it("항목 종류마다 점이 하나 있고 항목이 없으면 점이 없다", async () => {
    await renderLoaded();

    const noteAndDecision = dotsIn(cell(NOV_8));
    expect(noteAndDecision).toHaveLength(2);
    expect(noteAndDecision.flatMap(classesOf)).toEqual(
      expect.arrayContaining(["rounded-full", "bg-primary", "bg-muted-foreground"]),
    );
    expect(noteAndDecision.flatMap(classesOf)).not.toContain("border-primary");

    const todoOnly = dotsIn(cell(NOV_13));
    expect(todoOnly).toHaveLength(1);
    expect(classesOf(todoOnly[0])).toEqual(
      expect.arrayContaining(["rounded-full", "border", "border-primary"]),
    );

    expect(dotsIn(cell(NOV_20))).toHaveLength(1);
    expect(dotsIn(cell(NOV_9))).toHaveLength(0);
  });

  it("칸에 첫 항목 제목이 한 줄로 보이고 노트, 결정, 할 일 순서로 고른다", async () => {
    await renderLoaded();

    const first = within(cell(NOV_8) as HTMLElement).queryByText("주간 회의");
    expect(classesOf(first)).toEqual(expect.arrayContaining(["truncate", "text-xs"]));
    expect(within(cell(NOV_8) as HTMLElement).queryByText("금요일에 배포한다")).toBeNull();
    expect(within(cell(NOV_13) as HTMLElement).queryByText("배포 공지 쓰기")).not.toBeNull();
    expect(within(cell(NOV_20) as HTMLElement).queryByText("첫째 메모")).not.toBeNull();
    expect(within(cell(NOV_20) as HTMLElement).queryByText("둘째 메모")).toBeNull();
  });

  it("오늘은 숫자에, 선택한 날은 칸에 표시되고 선택을 옮겨도 오늘 표시는 남는다", async () => {
    const { user } = await renderLoaded();
    const today = ["bg-primary", "text-primary-foreground", "rounded-full"];

    expect(classesOf(within(cell(NOV_8) as HTMLElement).queryByText("8"))).toEqual(
      expect.arrayContaining(today),
    );
    expect(classesOf(cell(NOV_8))).toContain("bg-accent");
    expect(classesOf(within(cell(NOV_9) as HTMLElement).queryByText("9"))).not.toContain(
      "bg-primary",
    );

    await user.click(cell(NOV_13) as HTMLElement);

    expect(classesOf(cell(NOV_13))).toContain("bg-accent");
    expect(classesOf(cell(NOV_8))).not.toContain("bg-accent");
    expect(classesOf(within(cell(NOV_8) as HTMLElement).queryByText("8"))).toEqual(
      expect.arrayContaining(today),
    );
  });

  it("다른 달 날짜만 흐리게 보인다", async () => {
    await renderLoaded();

    expect(classesWithin(cell(DEC_1))).toContain("text-muted-foreground/50");
    expect(classesWithin(cell(NOV_9))).not.toContain("text-muted-foreground/50");
  });

  it.each([
    ["자정 직후", new Date(2026, 11, 1, 0, 30), "2026-12", "2026년 12월", "12월 1일 (화)"],
    ["자정 직전", new Date(2026, 10, 30, 23, 30), "2026-11", "2026년 11월", "11월 30일 (월)"],
  ])("오늘은 로컬 날짜다 (%s)", async (_label, now, month, title, panel) => {
    vi.setSystemTime(now);
    const months = stubCalendar({});
    renderCalendar();

    await waitForElement(() => heading(panel));
    expect(months[0]).toBe(month);
    expect(heading(title)).not.toBeNull();
  });
});

describe("J033 날짜 패널", () => {
  it("처음에는 오늘의 항목을 Card 안 세 구역에 보여 주고 빈 구역은 없음이다", async () => {
    await renderLoaded();

    const title = heading("11월 8일 (일)");
    expect(cardOf(title)).not.toBeNull();
    expect(cardOf(title)).not.toBe(cardOf(allCells()[0]));
    expect(rowIn("노트", /주간 회의/)).not.toBeNull();
    expect(rowIn("결정 사항", /금요일에 배포한다/)).not.toBeNull();
    expect(within(region("기한인 할 일") as HTMLElement).queryByText("없음")).not.toBeNull();
    expect(cardOf(region("노트"))).toBe(cardOf(title));
  });

  it("날짜 칸을 누르면 그날 항목으로 바뀐다", async () => {
    const { user } = await renderLoaded();

    await user.click(cell(NOV_13) as HTMLElement);

    expect(heading("11월 13일 (금)")).not.toBeNull();
    expect(heading("11월 8일 (일)")).toBeNull();
    expect(rowIn("기한인 할 일", /배포 공지 쓰기/)).not.toBeNull();
    expect(within(region("노트") as HTMLElement).queryByText("없음")).not.toBeNull();
  });

  it("노트·결정·할 일 행은 ghost 버튼이고 누르면 각자의 note_id로 onOpenNote를 부른다", async () => {
    const { user, onOpenNote } = await renderLoaded();

    const noteRow = rowIn("노트", /주간 회의/);
    expect(noteRow.getAttribute("data-variant")).toBe("ghost");
    await user.click(noteRow);
    expect(onOpenNote).toHaveBeenLastCalledWith(1);

    await user.click(rowIn("결정 사항", /금요일에 배포한다/));
    expect(onOpenNote).toHaveBeenLastCalledWith(7);

    await user.click(cell(NOV_13) as HTMLElement);
    await user.click(rowIn("기한인 할 일", /회고 정리/));
    expect(onOpenNote).toHaveBeenLastCalledWith(4);
    expect(onOpenNote).toHaveBeenCalledTimes(3);
  });

  it("완료한 할 일만 취소선이다", async () => {
    const { user } = await renderLoaded();

    await user.click(cell(NOV_13) as HTMLElement);

    expect(classesWithin(rowIn("기한인 할 일", /회고 정리/))).toEqual(
      expect.arrayContaining(["line-through", "text-muted-foreground"]),
    );
    expect(classesWithin(rowIn("기한인 할 일", /배포 공지 쓰기/))).not.toContain("line-through");
  });

  it("빈 날은 구역 없이 점선 영역을 보여 준다", async () => {
    const { user } = await renderLoaded();

    await user.click(cell(NOV_9) as HTMLElement);

    expect(heading("11월 9일 (월)")).not.toBeNull();
    const text = screen.queryByText(EMPTY_DAY_TEXT);
    expect(classesOf(text?.closest(".border-dashed"))).toEqual(expect.arrayContaining(DASHED));
    expect(cardOf(text)).toBe(cardOf(heading("11월 9일 (월)")));
    expect(region("노트")).toBeNull();
    expect(region("결정 사항")).toBeNull();
    expect(region("기한인 할 일")).toBeNull();
  });
});

describe("J033 월 이동", () => {
  it("이동 버튼은 outline sm이고 아이콘이 있다", async () => {
    await renderLoaded();

    for (const name of ["이전 달", "다음 달", "오늘"]) {
      expect(button(name)?.getAttribute("data-variant")).toBe("outline");
      expect(button(name)?.getAttribute("data-size")).toBe("sm");
    }
    expect(button("이전 달")?.querySelector("svg.lucide-chevron-left")).not.toBeNull();
    expect(button("다음 달")?.querySelector("svg.lucide-chevron-right")).not.toBeNull();
  });

  it("다음 달을 누르면 2026-12를 부르고 1일을 선택하며 데이터를 그린다", async () => {
    const { user, months } = await renderLoaded({ "2026-11": november, "2026-12": december });

    await user.click(button("다음 달"));

    await waitForElement(() => cell(DEC_3_FILLED));
    expect(months).toEqual(["2026-11", "2026-12"]);
    expect(heading("2026년 12월")).not.toBeNull();
    expect(heading("12월 1일 (화)")).not.toBeNull();
    expect(classesOf(cell(DEC_1))).toContain("bg-accent");
  });

  it("이전 달을 누르면 전달을 부르고 1일을 선택한다", async () => {
    const { user, months } = await renderLoaded();

    await user.click(button("이전 달"));

    await waitForElement(() => heading("10월 1일 (목)"));
    expect(months).toEqual(["2026-11", "2026-10"]);
    expect(heading("2026년 10월")).not.toBeNull();
  });

  it("다음 달은 12월에서 다음 해 1월로 넘어간다", async () => {
    const { user, months } = await renderLoaded();

    await user.click(button("다음 달"));
    await waitForElement(() => heading("2026년 12월"));
    await waitForElement(() => allCells()[0] ?? null);
    await user.click(button("다음 달"));

    await waitForElement(() => heading("2027년 1월"));
    await waitForElement(() => allCells()[0] ?? null);
    expect(months).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("이전 달은 1월에서 전해 12월로 넘어간다", async () => {
    vi.setSystemTime(new Date(2026, 0, 15, 12, 0));
    const months = stubCalendar({});
    const { user } = renderCalendar();
    await waitForElement(() => allCells()[0] ?? null);

    await user.click(button("이전 달"));

    await waitForElement(() => heading("2025년 12월"));
    await waitForElement(() => allCells()[0] ?? null);
    expect(months).toEqual(["2026-01", "2025-12"]);
  });

  it("오늘 버튼은 오늘이 든 달과 오늘을 선택한다", async () => {
    const { user } = await renderLoaded({ "2026-11": november, "2026-12": december });
    await user.click(button("다음 달"));
    await waitForElement(() => cell(DEC_3_FILLED));

    await user.click(button("오늘"));

    await waitForElement(() => cell(NOV_8));
    expect(heading("2026년 11월")).not.toBeNull();
    expect(heading("11월 8일 (일)")).not.toBeNull();
    expect(classesOf(cell(NOV_8))).toContain("bg-accent");
  });

  it("다른 달 날짜 칸을 누르면 그 달로 옮겨 그 날짜를 선택한다", async () => {
    const { user, months } = await renderLoaded({ "2026-11": november, "2026-12": december });

    await user.click(cell(DEC_3_EMPTY) as HTMLElement);

    await waitForElement(() => cell(DEC_3_FILLED));
    expect(months).toEqual(["2026-11", "2026-12"]);
    expect(heading("2026년 12월")).not.toBeNull();
    expect(heading("12월 3일 (목)")).not.toBeNull();
    expect(rowIn("노트", /12월 메모/)).not.toBeNull();
  });
});

describe("J033 로딩과 오류", () => {
  it("로딩 중에는 Skeleton 3줄과 월 이동 줄만 있고 날짜 칸은 없다", async () => {
    const pending = stubDeferred();
    renderCalendar();

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(skeletons()).toHaveLength(3);
    expect(heading("2026년 11월")).not.toBeNull();
    expect(allCells()).toHaveLength(0);

    await settle(() => pending[0].resolve(json(november)));

    expect(skeletons()).toHaveLength(0);
    expect(cell(NOV_8)).not.toBeNull();
  });

  it("달을 바꾸는 중에는 이전 달 항목이 남지 않는다", async () => {
    const pending = stubDeferred();
    const { user } = renderCalendar();
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(() => pending[0].resolve(json(november)));

    await user.click(button("다음 달"));

    await waitFor(() => expect(pending).toHaveLength(2));
    expect(heading("2026년 12월")).not.toBeNull();
    expect(screen.queryByText("주간 회의")).toBeNull();
    expect(allCells()).toHaveLength(0);
    expect(skeletons()).toHaveLength(3);
  });

  it("API 오류면 alert와 다시 시도가 보이고 다시 시도하면 같은 달을 불러온다", async () => {
    const months: (string | null)[] = [];
    let healthy = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        months.push(urlOf(input).searchParams.get("month"));
        return healthy ? json(november) : json({ detail: "bad" }, 500);
      }),
    );
    const { user } = renderCalendar();

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert.getAttribute("data-slot")).toBe("alert");
    expect(heading("2026년 11월")).not.toBeNull();
    expect(allCells()).toHaveLength(0);

    healthy = true;
    await user.click(within(alert).queryByRole("button", { name: "다시 시도" }) as HTMLElement);

    await waitForElement(() => cell(NOV_8));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(months).toEqual(["2026-11", "2026-11"]);
  });

  async function moveAwayAndBack() {
    const pending = stubDeferred();
    const { user } = renderCalendar();
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(() => pending[0].resolve(json(november)));
    await user.click(button("다음 달"));
    await waitFor(() => expect(pending).toHaveLength(2));
    await user.click(button("이전 달"));
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending.map((request) => request.month)).toEqual(["2026-11", "2026-12", "2026-11"]);
    return pending;
  }

  it("최신 응답 뒤에 늦게 온 이전 요청의 응답은 버린다", async () => {
    const pending = await moveAwayAndBack();

    await settle(() => pending[2].resolve(json(november)));
    expect(cell(NOV_8)).not.toBeNull();

    await settle(() => pending[1].resolve(json(december)));

    expect(heading("2026년 11월")).not.toBeNull();
    expect(cell(NOV_8)).not.toBeNull();
    expect(cell(DEC_3_FILLED)).toBeNull();
    expect(cell(DEC_3_EMPTY)).not.toBeNull();
  });

  it("최신 응답보다 먼저 온 이전 요청의 응답도 화면에 쓰지 않는다", async () => {
    const pending = await moveAwayAndBack();

    await settle(() => pending[1].resolve(json(december)));

    expect(skeletons()).toHaveLength(3);
    expect(allCells()).toHaveLength(0);

    await settle(() => pending[2].resolve(json(november)));

    expect(cell(NOV_8)).not.toBeNull();
    expect(cell(DEC_3_FILLED)).toBeNull();
  });

  it("늦게 온 이전 요청의 실패는 오류를 띄우지 않는다", async () => {
    const pending = await moveAwayAndBack();

    await settle(() => pending[2].resolve(json(november)));
    await settle(() => pending[1].resolve(json({ detail: "bad" }, 500)));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(cell(NOV_8)).not.toBeNull();
  });
});

describe("J033 App 탭", () => {
  function tab(name: string): HTMLElement | null {
    return screen.queryByRole("button", { name });
  }

  async function openCalendarTab() {
    const user = userEvent.setup();
    stubApp();
    render(<App />);
    await waitForElement(() => tab("캘린더"));
    await user.click(tab("캘린더") as HTMLElement);
    return user;
  }

  it("캘린더는 아이콘이 있는 다섯 번째 탭이고 누르면 캘린더 화면이 보인다", async () => {
    await openCalendarTab();

    const calendarTab = tab("캘린더") as HTMLElement;
    expect(calendarTab.getAttribute("aria-current")).toBe("page");
    expect(calendarTab.querySelector("svg.lucide-calendar-days")).not.toBeNull();
    const labels = Array.from(calendarTab.parentElement?.children ?? []).map(
      (element) => element.textContent,
    );
    expect(labels).toEqual(["노트", "할 일", "찾기", "주간 정리", "캘린더"]);

    await waitForElement(() => heading("2026년 11월"));
    await waitForElement(() => cell(NOV_8));
  });

  it("패널의 노트 행을 누르면 노트 탭의 상세가 열린다", async () => {
    const user = await openCalendarTab();
    await waitForElement(() => region("노트"));

    await user.click(rowIn("노트", /주간 회의/));

    await waitForElement(() =>
      screen.queryByRole("heading", { name: noteDetail.title, level: 2 }),
    );
    expect(tab("노트")?.getAttribute("aria-current")).toBe("page");
    expect(heading("2026년 11월")).toBeNull();
  });
});
