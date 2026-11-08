import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Weekly from "./Weekly";

const PERIOD = "2026-10-19 ~ 2026-10-25";
const SECTIONS = ["이번 주 노트", "결정 사항", "남은 할 일"];

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
  ],
};

function week(start: string, end: string) {
  return { start, end, notes: [], decisions: [], open_todos: [] };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function failure(): Response {
  return json({ detail: "boom" }, 500);
}

function deferred() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Reply = () => Response | Promise<Response>;

// 가짜 서버: GET /api/weekly는 date 쿼리(없으면 "")로 weeks에서 응답을 고른다.
function stubApi(weeks: Record<string, Reply>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/weekly") {
      const reply = weeks[parsed.searchParams.get("date") ?? ""];
      return reply ? reply() : json({ detail: "unexpected date" }, 500);
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

function region(name: string): HTMLElement {
  return screen.queryByRole("region", { name }) as HTMLElement;
}

function skeletons(): Element[] {
  return Array.from(document.querySelectorAll('[data-slot="skeleton"]'));
}

// section이 Card를 감싸든 Card가 section을 감싸든 같은 구역의 Card를 찾는다.
function cardOf(section: HTMLElement): HTMLElement | null {
  return (
    section.closest<HTMLElement>('[data-slot="card"]') ??
    section.querySelector<HTMLElement>('[data-slot="card"]')
  );
}

function twoColumnGrid(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node !== null) {
    if (node.classList.contains("grid") && node.classList.contains("lg:grid-cols-2")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function renderWeekly() {
  render(<Weekly onOpenNote={vi.fn()} />);
}

async function renderLoaded(reply: Reply) {
  stubApi({ "": reply });
  renderWeekly();
  await waitForElement(() => screen.queryByText(PERIOD));
}

// jest-dom 매처의 실패는 assertion 실패로 집계되지 않으므로 값을 꺼내 expect로 비교한다.
function classesOf(element: Element | null | undefined): string[] {
  return Array.from(element?.classList ?? []);
}

function expectSlotButton(element: HTMLElement | null, variant: string) {
  expect(element).not.toBeNull();
  expect(element?.getAttribute("data-slot")).toBe("button");
  expect(element?.getAttribute("data-variant")).toBe(variant);
}

function expectDestructiveAlert(alert: HTMLElement) {
  expect(alert.getAttribute("data-slot")).toBe("alert");
  expect(classesOf(alert)).toContain("text-destructive");
  expect(alert.textContent).toContain("주간 정리를 불러오지 못했습니다");
}

describe("J024 주간 정리 화면 디자인", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("주 이동 버튼은 outline·sm Button이고 글자와 Chevron 아이콘을 함께 갖는다", async () => {
    await renderLoaded(() => json(filledWeek));

    const previous = button("지난주");
    expectSlotButton(previous, "outline");
    expect(previous?.getAttribute("data-size")).toBe("sm");
    expect(previous?.querySelector("svg.lucide-chevron-left")).not.toBeNull();

    const next = button("다음 주");
    expectSlotButton(next, "outline");
    expect(next?.getAttribute("data-size")).toBe("sm");
    expect(next?.querySelector("svg.lucide-chevron-right")).not.toBeNull();
  });

  it("가운데 기간 글자는 font-medium이다", async () => {
    await renderLoaded(() => json(filledWeek));

    expect(classesOf(screen.queryByText(PERIOD))).toContain("font-medium");
  });

  it("세 구역은 section이고 각각 Card이며, h2는 수준·글자를 지키고 text-base font-semibold다", async () => {
    await renderLoaded(() => json(filledWeek));

    for (const name of SECTIONS) {
      const section = region(name);
      expect(section.tagName).toBe("SECTION");
      expect(cardOf(section)).not.toBeNull();

      const heading = within(section).queryByRole("heading", { level: 2, name });
      expect(heading).not.toBeNull();
      expect(heading?.tagName).toBe("H2");
      expect(classesOf(heading)).toEqual(expect.arrayContaining(["text-base", "font-semibold"]));
    }
  });

  it("노트·결정 구역은 같은 2열 grid에 있고 남은 할 일은 그 밖에 있다", async () => {
    await renderLoaded(() => json(filledWeek));

    const grid = twoColumnGrid(region("이번 주 노트"));
    expect(grid).not.toBeNull();
    expect(twoColumnGrid(region("결정 사항"))).toBe(grid);
    expect(grid?.contains(region("남은 할 일"))).toBe(false);
  });

  it("노트 행과 결정 행은 ghost Button이고 할 일 행은 버튼이 아니다", async () => {
    await renderLoaded(() => json(filledWeek));

    const noteRows = within(region("이번 주 노트")).queryAllByRole("button");
    expect(noteRows).toHaveLength(2);
    noteRows.forEach((row) => expectSlotButton(row, "ghost"));

    const decisionRows = within(region("결정 사항")).queryAllByRole("button");
    expect(decisionRows).toHaveLength(1);
    decisionRows.forEach((row) => expectSlotButton(row, "ghost"));

    expect(within(region("남은 할 일")).queryAllByRole("button")).toHaveLength(0);
  });

  it("처음 불러오는 중에는 Skeleton 3줄과 문구가 함께 보이고 응답이 오면 Skeleton이 사라진다", async () => {
    const pending = deferred();
    stubApi({ "": () => pending.promise });
    renderWeekly();

    await waitForElement(() => screen.queryByText("불러오는 중…"));
    expect(skeletons()).toHaveLength(3);

    await act(async () => {
      pending.resolve(json(week("2026-10-19", "2026-10-25")));
    });
    await waitForElement(() => screen.queryByText(PERIOD));
    expect(skeletons()).toHaveLength(0);
  });

  it("다른 주를 불러오는 중에도 Skeleton 3줄과 문구가 함께 보인다", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    stubApi({
      "": () => json(week("2026-10-19", "2026-10-25")),
      "2026-10-12": () => pending.promise,
    });
    renderWeekly();
    await waitForElement(() => screen.queryByText(PERIOD));

    await user.click(button("지난주") as HTMLElement);
    await waitForElement(() => screen.queryByText("불러오는 중…"));
    expect(skeletons()).toHaveLength(3);

    await act(async () => {
      pending.resolve(json(week("2026-10-12", "2026-10-18")));
    });
    await waitForElement(() => screen.queryByText("2026-10-12 ~ 2026-10-18"));
    expect(skeletons()).toHaveLength(0);
  });

  it("처음 불러오기에 실패하면 destructive Alert와 outline '다시 시도'가 보인다", async () => {
    stubApi({ "": failure });
    renderWeekly();

    expectDestructiveAlert(await waitForElement(() => screen.queryByRole("alert")));
    expectSlotButton(button("다시 시도"), "outline");
  });

  it("다른 주 불러오기에 실패해도 destructive Alert와 outline '다시 시도'가 보인다", async () => {
    const user = userEvent.setup();
    stubApi({ "": () => json(filledWeek), "2026-10-12": failure });
    renderWeekly();
    await waitForElement(() => screen.queryByText(PERIOD));

    await user.click(button("지난주") as HTMLElement);

    expectDestructiveAlert(await waitForElement(() => screen.queryByRole("alert")));
    expectSlotButton(button("다시 시도"), "outline");
  });

  it("비어 있는 구역의 '없음'은 구역 안의 점선 영역에 있다", async () => {
    await renderLoaded(() => json(week("2026-10-19", "2026-10-25")));

    for (const name of SECTIONS) {
      const section = region(name);
      const empty = within(section).queryByText("없음");
      expect(empty).not.toBeNull();
      const dashed = empty?.closest(".border-dashed") ?? null;
      expect(dashed).not.toBeNull();
      expect(section.contains(dashed)).toBe(true);
    }
  });
});
