import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Note = { id: number; title: string; body: string; created_at: string };

const weekly: Note = {
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

const searchResult = {
  notes: [
    { id: 2, title: "아이디어 메모", snippet: "검색 화면 개선", created_at: memo.created_at },
  ],
  decisions: [
    {
      id: 7,
      note_id: 1,
      note_title: "주간 회의",
      text: "금요일에 배포한다",
      created_at: weekly.created_at,
    },
  ],
};

const askResult = {
  answer: "금요일에 배포하기로 했습니다",
  sources: [{ id: 1, title: "주간 회의", created_at: weekly.created_at }],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { method: string; path: string; query: string; body: unknown };

type Options = {
  search?: () => Response | Promise<Response>;
  ask?: () => Response | Promise<Response>;
};

// 가짜 서버: /api/search·/api/ask는 options(기본: searchResult·askResult)를 돌려주고,
// GET /api/notes·/api/notes/{id}는 notes를 돌려준다.
function stubApi(options: Options = {}) {
  const notes = [memo, weekly];
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, path, query: parsed.searchParams.get("q") ?? "", body });
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/search" && method === "GET") {
      return options.search ? options.search() : json(searchResult);
    }
    if (path === "/api/ask" && method === "POST") {
      return options.ask ? options.ask() : json(askResult);
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

function textbox(name: string): HTMLElement | null {
  return screen.queryByRole("textbox", { name });
}

function button(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

function region(name: string): HTMLElement | null {
  return screen.queryByRole("region", { name });
}

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
  await user.click(await waitForElement(() => button("찾기")));
  return waitForElement(() => textbox("검색어"));
}

async function runSearch(user: ReturnType<typeof userEvent.setup>, q: string) {
  const input = await openSearch(user);
  await user.type(input, q);
  await user.click(button("검색") as HTMLElement);
}

async function runAsk(user: ReturnType<typeof userEvent.setup>, question: string) {
  await openSearch(user);
  await user.type(textbox("질문") as HTMLElement, question);
  await user.click(button("질문") as HTMLElement);
}

function callsTo(calls: Call[], method: string, path: string): Call[] {
  return calls.filter((c) => c.method === method && c.path === path);
}

describe("J013 찾기 화면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'찾기' 탭을 누르면 검색·질문 입력칸과 버튼이 보이고 노트 목록은 숨겨지며, '노트' 탭으로 돌아갈 수 있다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await openSearch(user);
    expect(button("검색")).toBeInTheDocument();
    expect(textbox("질문")).toBeInTheDocument();
    expect(button("질문")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /아이디어 메모/ })).not.toBeInTheDocument();
    expect(button("새 노트")).not.toBeInTheDocument();
    expect(button("정리")).not.toBeInTheDocument();

    await user.click(button("노트") as HTMLElement);
    await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
    expect(textbox("검색어")).not.toBeInTheDocument();
  });

  it("검색어·질문이 비었거나 공백뿐이면 버튼이 막혀 있고 요청을 보내지 않는다", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    render(<App />);

    const input = await openSearch(user);
    expect((button("검색") as HTMLButtonElement).disabled).toBe(true);
    expect((button("질문") as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, "   ");
    await user.type(textbox("질문") as HTMLElement, "  ");
    expect((button("검색") as HTMLButtonElement).disabled).toBe(true);
    expect((button("질문") as HTMLButtonElement).disabled).toBe(true);
    await user.click(button("검색") as HTMLElement);
    await user.click(button("질문") as HTMLElement);
    expect(callsTo(calls, "GET", "/api/search")).toEqual([]);
    expect(callsTo(calls, "POST", "/api/ask")).toEqual([]);

    await user.type(input, "배포");
    expect((button("검색") as HTMLButtonElement).disabled).toBe(false);
  });

  it("검색하면 GET /api/search?q=를 부르고 노트와 결정 사항을 나눠 보여 준다", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    render(<App />);

    await runSearch(user, "배포 일정");

    const notesRegion = await waitForElement(() => region("노트 결과"));
    const decisionsRegion = await waitForElement(() => region("결정 사항 결과"));
    expect(callsTo(calls, "GET", "/api/search").map((c) => c.query)).toEqual(["배포 일정"]);

    const noteButtons = within(notesRegion).queryAllByRole("button");
    expect(noteButtons).toHaveLength(1);
    expect(noteButtons[0]).toHaveTextContent("아이디어 메모");
    expect(noteButtons[0]).toHaveTextContent("검색 화면 개선");

    const decisionButtons = within(decisionsRegion).queryAllByRole("button");
    expect(decisionButtons).toHaveLength(1);
    expect(decisionButtons[0]).toHaveTextContent("금요일에 배포한다");
    expect(decisionButtons[0]).toHaveTextContent("주간 회의");
    expect(within(notesRegion).queryByText("금요일에 배포한다")).not.toBeInTheDocument();
    expect(screen.queryByText("없음")).not.toBeInTheDocument();
    expect(textbox("검색어")).toHaveValue("배포 일정");
  });

  it("검색 결과의 노트 항목을 누르면 그 노트 상세가 열린다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await runSearch(user, "검색");
    const notesRegion = await waitForElement(() => region("노트 결과"));
    await user.click(within(notesRegion).queryAllByRole("button")[0]);

    await waitForElement(() => screen.queryByRole("heading", { name: "아이디어 메모" }));
    expect(screen.queryByText("검색 화면 개선")).toBeInTheDocument();
    expect(textbox("검색어")).not.toBeInTheDocument();
  });

  it("결정 사항 항목을 누르면 그 결정의 노트 상세가 열린다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await runSearch(user, "배포");
    const decisionsRegion = await waitForElement(() => region("결정 사항 결과"));
    await user.click(within(decisionsRegion).queryAllByRole("button")[0]);

    await waitForElement(() => screen.queryByRole("heading", { name: "주간 회의" }));
    expect(screen.queryByText("배포 일정을 정했다")).toBeInTheDocument();
  });

  it("검색 결과가 모두 비면 '없음' 하나만 보인다", async () => {
    const user = userEvent.setup();
    stubApi({ search: () => json({ notes: [], decisions: [] }) });
    render(<App />);

    await runSearch(user, "없는말");

    await waitForElement(() => screen.queryByText("없음"));
    expect(screen.queryAllByText("없음")).toHaveLength(1);
    expect(region("노트 결과")).not.toBeInTheDocument();
    expect(region("결정 사항 결과")).not.toBeInTheDocument();
  });

  it("결정 사항만 비면 결정 사항 영역에 '없음'이 보인다", async () => {
    const user = userEvent.setup();
    stubApi({ search: () => json({ notes: searchResult.notes, decisions: [] }) });
    render(<App />);

    await runSearch(user, "검색");

    const decisionsRegion = await waitForElement(() => region("결정 사항 결과"));
    expect(within(decisionsRegion).queryByText("없음")).toBeInTheDocument();
    expect(within(decisionsRegion).queryAllByRole("button")).toHaveLength(0);
    const notesRegion = region("노트 결과") as HTMLElement;
    expect(within(notesRegion).queryAllByRole("button")).toHaveLength(1);
  });

  it("/api/search가 실패하면 '검색하지 못했습니다'를 보여 주고 검색어를 남긴다", async () => {
    const user = userEvent.setup();
    stubApi({ search: () => json({ detail: "q must not be blank" }, 422) });
    render(<App />);

    await runSearch(user, "배포");

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("검색하지 못했습니다");
    expect(textbox("검색어")).toHaveValue("배포");
    expect(region("노트 결과")).not.toBeInTheDocument();
  });

  it("질문하면 POST /api/ask에 {question}을 보내고 답변과 근거 노트 제목을 보여 주며, 근거를 누르면 노트 상세가 열린다", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    render(<App />);

    await runAsk(user, "배포는 언제?");

    const answer = await waitForElement(() => region("답변"));
    expect(callsTo(calls, "POST", "/api/ask").map((c) => c.body)).toEqual([
      { question: "배포는 언제?" },
    ]);
    expect(answer).toHaveTextContent("금요일에 배포하기로 했습니다");
    const sources = within(answer).queryAllByRole("button");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toHaveTextContent("주간 회의");
    expect(textbox("질문")).toHaveValue("배포는 언제?");

    await user.click(sources[0]);
    await waitForElement(() => screen.queryByRole("heading", { name: "주간 회의" }));
    expect(screen.queryByText("배포 일정을 정했다")).toBeInTheDocument();
  });

  it("/api/ask가 {answer: '없음', sources: []}면 '없음'만 보이고 근거 목록은 없다", async () => {
    const user = userEvent.setup();
    stubApi({ ask: () => json({ answer: "없음", sources: [] }) });
    render(<App />);

    await runAsk(user, "점심 메뉴는?");

    const answer = await waitForElement(() => region("답변"));
    expect(answer).toHaveTextContent(/^\s*없음\s*$/);
    expect(within(answer).queryAllByRole("button")).toHaveLength(0);
    expect(within(answer).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("/api/ask가 502면 '질문하지 못했습니다'와 message·problems를 보여 주고 질문을 남긴다", async () => {
    const user = userEvent.setup();
    stubApi({
      ask: () =>
        json(
          {
            detail: {
              message: "모델이 후보에 없는 노트를 근거로 냈습니다",
              problems: ["sources에 후보가 아닌 노트 id가 있습니다: 99"],
            },
          },
          502,
        ),
    });
    render(<App />);

    await runAsk(user, "배포는 언제?");

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("질문하지 못했습니다");
    expect(alert).toHaveTextContent("모델이 후보에 없는 노트를 근거로 냈습니다");
    expect(alert).toHaveTextContent("sources에 후보가 아닌 노트 id가 있습니다: 99");
    expect(textbox("질문")).toHaveValue("배포는 언제?");
    expect(region("답변")).not.toBeInTheDocument();
  });

  it("/api/ask가 422면 '질문하지 못했습니다'를 보여 준다", async () => {
    const user = userEvent.setup();
    stubApi({
      ask: () =>
        json(
          { detail: [{ type: "missing", loc: ["body", "question"], msg: "Field required" }] },
          422,
        ),
    });
    render(<App />);

    await runAsk(user, "배포는 언제?");

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("질문하지 못했습니다");
    expect(region("답변")).not.toBeInTheDocument();
  });
});
