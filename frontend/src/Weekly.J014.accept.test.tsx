import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Note = { id: number; title: string; body: string; created_at: string };

const meeting: Note = {
  id: 1,
  title: "주간 회의",
  body: "배포 일정을 정했다",
  created_at: "2026-10-20T09:00:00+00:00",
};
const memo: Note = {
  id: 2,
  title: "아이디어 메모",
  body: "검색 화면 개선",
  created_at: "2026-10-22T08:00:00+00:00",
};

const thisWeek = {
  start: "2026-10-19",
  end: "2026-10-25",
  notes: [
    { id: 1, title: "주간 회의", summary: "배포 일정 논의", created_at: meeting.created_at },
    { id: 2, title: "아이디어 메모", summary: null, created_at: memo.created_at },
  ],
  decisions: [
    {
      id: 7,
      note_id: 1,
      note_title: "주간 회의",
      text: "금요일에 배포한다",
      created_at: meeting.created_at,
    },
  ],
  open_todos: [
    {
      id: 3,
      note_id: 1,
      task: "배포 공지 쓰기",
      owner: "민수",
      due: "2026-10-23",
      done: false,
      created_at: meeting.created_at,
    },
    {
      id: 4,
      note_id: 2,
      task: "화면 스케치",
      owner: null,
      due: null,
      done: false,
      created_at: memo.created_at,
    },
  ],
};

function emptyWeek(start: string, end: string) {
  return { start, end, notes: [], decisions: [], open_todos: [] };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { method: string; path: string; date: string | null };

// 가짜 서버: GET /api/weekly는 date 쿼리(없으면 "")로 weeks에서 응답을 고른다.
// GET /api/notes·/api/notes/{id}는 노트를 돌려준다.
function stubApi(weeks: Record<string, () => Response>) {
  const notes = [memo, meeting];
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const date = parsed.searchParams.get("date");
    calls.push({ method, path, date });
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/weekly" && method === "GET") {
      const reply = weeks[date ?? ""];
      return reply ? reply() : json({ detail: "unexpected date" }, 500);
    }
    if (path === "/api/notes" && method === "GET") {
      return json(notes);
    }
    const noteMatch = /^\/api\/notes\/(\d+)$/.exec(path);
    if (noteMatch && method === "GET") {
      const note = notes.find((n) => n.id === Number(noteMatch[1]));
      return note ? json(note) : json({ detail: "Not Found" }, 404);
    }
    if (path === "/api/todos" && method === "GET") {
      return json([]);
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForElement(query: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(query()).not.toBeNull());
  return query() as HTMLElement;
}

function button(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

function region(name: string): HTMLElement | null {
  return screen.queryByRole("region", { name });
}

function weeklyCalls(calls: Call[]): (string | null)[] {
  return calls.filter((c) => c.method === "GET" && c.path === "/api/weekly").map((c) => c.date);
}

async function openWeekly(user: ReturnType<typeof userEvent.setup>) {
  await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
  await user.click(await waitForElement(() => button("주간 정리")));
}

describe("J014 주간 정리 화면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'주간 정리' 탭을 누르면 date 없이 /api/weekly를 부르고 기간과 세 구역을 보여 주며, 노트 목록은 숨긴다", async () => {
    const user = userEvent.setup();
    const calls = stubApi({ "": () => json(thisWeek) });
    render(<App />);

    await openWeekly(user);

    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    expect(weeklyCalls(calls)).toEqual([null]);

    const notesRegion = region("이번 주 노트") as HTMLElement;
    expect(notesRegion).not.toBeNull();
    const noteButtons = within(notesRegion).queryAllByRole("button");
    expect(noteButtons).toHaveLength(2);
    expect(noteButtons[0]).toHaveTextContent("주간 회의");
    expect(noteButtons[0]).toHaveTextContent("배포 일정 논의");
    expect(noteButtons[1]).toHaveTextContent("아이디어 메모");
    expect(noteButtons[1]).not.toHaveTextContent("null");

    const decisionsRegion = region("결정 사항") as HTMLElement;
    expect(decisionsRegion).not.toBeNull();
    const decisionButtons = within(decisionsRegion).queryAllByRole("button");
    expect(decisionButtons).toHaveLength(1);
    expect(decisionButtons[0]).toHaveTextContent("금요일에 배포한다");
    expect(decisionButtons[0]).toHaveTextContent("주간 회의");

    const todosRegion = region("남은 할 일") as HTMLElement;
    expect(todosRegion).not.toBeNull();
    const todoItems = within(todosRegion).queryAllByRole("listitem");
    expect(todoItems).toHaveLength(2);
    expect(todoItems[0]).toHaveTextContent("배포 공지 쓰기");
    expect(todoItems[0]).toHaveTextContent("담당: 민수");
    expect(todoItems[0]).toHaveTextContent("기한: 2026-10-23");
    expect(todoItems[1]).toHaveTextContent("화면 스케치");
    expect(todoItems[1]).not.toHaveTextContent("담당");
    expect(todoItems[1]).not.toHaveTextContent("기한");

    expect(screen.queryByText("없음")).not.toBeInTheDocument();
    expect(button("새 노트")).not.toBeInTheDocument();
    expect(button("정리")).not.toBeInTheDocument();

    await user.click(button("노트") as HTMLElement);
    await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
    expect(region("이번 주 노트")).not.toBeInTheDocument();
  });

  it("'지난주'를 누르면 start에서 7일 뺀 date로, '다음 주'를 누르면 7일 더한 date로 다시 부른다", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      "": () => json(thisWeek),
      "2026-10-12": () => json(emptyWeek("2026-10-12", "2026-10-18")),
      "2026-10-19": () => json(thisWeek),
    });
    render(<App />);

    await openWeekly(user);
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));

    await user.click(button("지난주") as HTMLElement);
    await waitForElement(() => screen.queryByText("2026-10-12 ~ 2026-10-18"));
    expect(weeklyCalls(calls)).toEqual([null, "2026-10-12"]);
    expect(screen.queryByText("2026-10-19 ~ 2026-10-25")).not.toBeInTheDocument();
    expect(within(region("이번 주 노트") as HTMLElement).queryAllByRole("button")).toHaveLength(0);

    await user.click(button("다음 주") as HTMLElement);
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    expect(weeklyCalls(calls)).toEqual([null, "2026-10-12", "2026-10-19"]);
    expect(within(region("이번 주 노트") as HTMLElement).queryAllByRole("button")).toHaveLength(2);
  });

  it("달과 해가 바뀌는 주에서도 '지난주'·'다음 주' 날짜가 맞다", async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      "": () => json(emptyWeek("2026-11-02", "2026-11-08")),
      "2026-10-26": () => json(emptyWeek("2026-10-26", "2026-11-01")),
      "2026-11-02": () => json(emptyWeek("2026-11-02", "2026-11-08")),
      "2026-11-09": () => json(emptyWeek("2026-12-28", "2027-01-03")),
      "2027-01-04": () => json(emptyWeek("2027-01-04", "2027-01-10")),
    });
    render(<App />);

    await openWeekly(user);
    await waitForElement(() => screen.queryByText("2026-11-02 ~ 2026-11-08"));

    await user.click(button("지난주") as HTMLElement);
    await waitForElement(() => screen.queryByText("2026-10-26 ~ 2026-11-01"));
    await user.click(button("다음 주") as HTMLElement);
    await waitForElement(() => screen.queryByText("2026-11-02 ~ 2026-11-08"));
    await user.click(button("다음 주") as HTMLElement);
    await waitForElement(() => screen.queryByText("2026-12-28 ~ 2027-01-03"));
    await user.click(button("다음 주") as HTMLElement);
    await waitForElement(() => screen.queryByText("2027-01-04 ~ 2027-01-10"));

    expect(weeklyCalls(calls)).toEqual([
      null,
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
      "2027-01-04",
    ]);
  });

  it("빈 구역에는 '없음'이 보인다", async () => {
    const user = userEvent.setup();
    stubApi({
      "": () => json({ ...thisWeek, decisions: [], open_todos: [] }),
    });
    render(<App />);

    await openWeekly(user);
    const decisionsRegion = await waitForElement(() => region("결정 사항"));
    expect(within(decisionsRegion).queryByText("없음")).toBeInTheDocument();
    expect(within(decisionsRegion).queryAllByRole("button")).toHaveLength(0);
    const todosRegion = region("남은 할 일") as HTMLElement;
    expect(within(todosRegion).queryByText("없음")).toBeInTheDocument();
    expect(within(todosRegion).queryAllByRole("listitem")).toHaveLength(0);
    const notesRegion = region("이번 주 노트") as HTMLElement;
    expect(within(notesRegion).queryByText("없음")).not.toBeInTheDocument();
    expect(within(notesRegion).queryAllByRole("button")).toHaveLength(2);
  });

  it("세 구역이 모두 비면 구역마다 '없음'이 보인다", async () => {
    const user = userEvent.setup();
    stubApi({ "": () => json(emptyWeek("2026-10-19", "2026-10-25")) });
    render(<App />);

    await openWeekly(user);
    await waitForElement(() => screen.queryByText("2026-10-19 ~ 2026-10-25"));
    for (const name of ["이번 주 노트", "결정 사항", "남은 할 일"]) {
      const section = region(name) as HTMLElement;
      expect(section).not.toBeNull();
      expect(within(section).queryByText("없음")).toBeInTheDocument();
    }
    expect(screen.queryAllByText("없음")).toHaveLength(3);
  });

  it("결정 항목을 누르면 그 결정의 노트 상세가 열린다", async () => {
    const user = userEvent.setup();
    stubApi({ "": () => json(thisWeek) });
    render(<App />);

    await openWeekly(user);
    const decisionsRegion = await waitForElement(() => region("결정 사항"));
    await waitFor(() => expect(within(decisionsRegion).queryAllByRole("button")).toHaveLength(1));
    await user.click(within(decisionsRegion).queryAllByRole("button")[0]);

    await waitForElement(() => screen.queryByRole("heading", { name: "주간 회의" }));
    expect(screen.queryByText("배포 일정을 정했다")).toBeInTheDocument();
    expect(region("결정 사항")).not.toBeInTheDocument();
  });

  it("노트 항목을 누르면 그 노트 상세가 열린다", async () => {
    const user = userEvent.setup();
    stubApi({ "": () => json(thisWeek) });
    render(<App />);

    await openWeekly(user);
    const notesRegion = await waitForElement(() => region("이번 주 노트"));
    await waitFor(() => expect(within(notesRegion).queryAllByRole("button")).toHaveLength(2));
    await user.click(within(notesRegion).queryAllByRole("button")[1]);

    await waitForElement(() => screen.queryByRole("heading", { name: "아이디어 메모" }));
    expect(screen.queryByText("검색 화면 개선")).toBeInTheDocument();
  });

  it("/api/weekly가 실패하면 '주간 정리를 불러오지 못했습니다'를 보여 준다", async () => {
    const user = userEvent.setup();
    stubApi({ "": () => json({ detail: "boom" }, 500) });
    render(<App />);

    await openWeekly(user);

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("주간 정리를 불러오지 못했습니다");
    expect(region("이번 주 노트")).not.toBeInTheDocument();
  });
});
