import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const memo = {
  id: 2,
  title: "아이디어 메모",
  body: "검색 화면 개선",
  created_at: "2026-10-22T08:00:00+00:00",
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

type Reply = () => Response | Promise<Response>;

// 테스트가 직접 풀어 주는 지연 응답.
function deferred() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// 부를 때마다 다음 응답을 쓴다 (마지막 응답은 계속 쓴다).
function sequence(...replies: Reply[]): Reply {
  let index = 0;
  return () => replies[Math.min(index++, replies.length - 1)]();
}

function failure(): Response {
  return json({ detail: "boom" }, 500);
}

// 가짜 서버: GET /api/weekly는 date 쿼리(없으면 "")로 weeks에서 응답을 고른다.
function stubApi(weeks: Record<string, Reply>) {
  const dates: (string | null)[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/weekly" && method === "GET") {
      const date = parsed.searchParams.get("date");
      dates.push(date);
      const reply = weeks[date ?? ""];
      return reply ? reply() : json({ detail: "unexpected date" }, 500);
    }
    if (path === "/api/notes" && method === "GET") {
      return json([memo]);
    }
    if (path === "/api/todos" && method === "GET") {
      return json([]);
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return dates;
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForElement(query: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(query()).not.toBeNull());
  return query() as HTMLElement;
}

function button(name: string): HTMLButtonElement | null {
  return screen.queryByRole("button", { name }) as HTMLButtonElement | null;
}

async function openWeekly(user: ReturnType<typeof userEvent.setup>) {
  await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
  await user.click(await waitForElement(() => button("주간 정리")));
}

describe("J015 주간 정리 화면의 요청 중 상태", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("처음 불러오는 중에는 '불러오는 중…'이 보이고, 응답이 오면 사라진다", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    stubApi({ "": () => pending.promise });
    render(<App />);

    await openWeekly(user);
    await waitForElement(() => screen.queryByText("불러오는 중…"));

    await act(async () => {
      pending.resolve(json(week("2026-10-19", "2026-10-25")));
    });
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
  });

  it("다른 주를 불러오는 중에는 '불러오는 중…'이 보이고 '지난주'·'다음 주' 버튼이 막힌다", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const dates = stubApi({
      "": () => json(week("2026-10-19", "2026-10-25")),
      "2026-10-12": () => pending.promise,
    });
    render(<App />);

    await openWeekly(user);
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    expect(button("지난주")?.disabled).toBe(false);
    expect(button("다음 주")?.disabled).toBe(false);

    await user.click(button("지난주") as HTMLElement);
    await waitForElement(() => screen.queryByText("불러오는 중…"));
    expect(button("지난주")).not.toBeNull();
    expect(button("다음 주")).not.toBeNull();
    expect(button("지난주")?.disabled).toBe(true);
    expect(button("다음 주")?.disabled).toBe(true);
    expect(dates).toEqual([null, "2026-10-12"]);

    await act(async () => {
      pending.resolve(json(week("2026-10-12", "2026-10-18")));
    });
    await waitForElement(() => screen.queryByText("2026-10-12 ~ 2026-10-18"));
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
    expect(button("지난주")?.disabled).toBe(false);
    expect(button("다음 주")?.disabled).toBe(false);
  });

  it("다른 주 불러오기에 실패하면 오류와 '다시 시도'가 보이고, 누르면 같은 주를 다시 부른다", async () => {
    const user = userEvent.setup();
    const dates = stubApi({
      "": () => json(week("2026-10-19", "2026-10-25")),
      "2026-10-12": sequence(failure, () => json(week("2026-10-12", "2026-10-18"))),
    });
    render(<App />);

    await openWeekly(user);
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    await user.click(button("지난주") as HTMLElement);

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("주간 정리를 불러오지 못했습니다");
    await waitForElement(() => button("다시 시도"));
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
    expect(button("지난주")?.disabled).toBe(false);
    expect(button("다음 주")?.disabled).toBe(false);

    await user.click(button("다시 시도") as HTMLElement);
    await waitForElement(() => screen.queryByText("2026-10-12 ~ 2026-10-18"));
    expect(dates).toEqual([null, "2026-10-12", "2026-10-12"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(button("다시 시도")).not.toBeInTheDocument();
  });

  it("실패한 뒤 '다음 주'·'지난주'는 마지막으로 성공한 주를 기준으로 부른다", async () => {
    const user = userEvent.setup();
    const dates = stubApi({
      "": () => json(week("2026-10-19", "2026-10-25")),
      "2026-10-12": failure,
      "2026-10-26": () => json(week("2026-10-26", "2026-11-01")),
    });
    render(<App />);

    await openWeekly(user);
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    await user.click(button("지난주") as HTMLElement);
    await waitForElement(() => button("다시 시도"));

    await user.click(button("다음 주") as HTMLElement);
    await waitForElement(() => screen.queryByText("2026-10-26 ~ 2026-11-01"));
    expect(dates).toEqual([null, "2026-10-12", "2026-10-26"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("처음 불러오기에 실패하면 '다시 시도'로 date 없이 다시 부른다", async () => {
    const user = userEvent.setup();
    const dates = stubApi({
      "": sequence(failure, () => json(week("2026-10-19", "2026-10-25"))),
    });
    render(<App />);

    await openWeekly(user);
    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("주간 정리를 불러오지 못했습니다");

    await user.click(await waitForElement(() => button("다시 시도")));
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    expect(dates).toEqual([null, null]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
