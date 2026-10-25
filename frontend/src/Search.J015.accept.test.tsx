import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function searchResultWith(snippet: string) {
  return {
    notes: [{ id: 2, title: "아이디어 메모", snippet, created_at: memo.created_at }],
    decisions: [],
  };
}

const askResult = {
  answer: "금요일에 배포하기로 했습니다",
  sources: [{ id: 1, title: "주간 회의", created_at: meeting.created_at }],
};

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

type Call = { method: string; path: string; query: string; body: unknown };

// 가짜 서버: /api/search·/api/ask는 주어진 응답을, /api/notes는 노트를 돌려준다.
function stubApi(options: { search?: Reply; ask?: Reply }) {
  const notes = [memo, meeting];
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
    if (path === "/api/search" && method === "GET" && options.search) {
      return options.search();
    }
    if (path === "/api/ask" && method === "POST" && options.ask) {
      return options.ask();
    }
    if (path === "/api/notes" && method === "GET") {
      return json(notes);
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

// 늦게 도착한 응답의 처리가 끝날 시간을 준다.
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function textbox(name: string): HTMLElement | null {
  return screen.queryByRole("textbox", { name });
}

function button(name: string): HTMLButtonElement | null {
  return screen.queryByRole("button", { name }) as HTMLButtonElement | null;
}

function region(name: string): HTMLElement | null {
  return screen.queryByRole("region", { name });
}

function alertWith(text: string): HTMLElement | null {
  return screen.queryAllByRole("alert").find((el) => el.textContent?.includes(text)) ?? null;
}

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
  await user.click(await waitForElement(() => button("찾기")));
  await waitForElement(() => textbox("검색어"));
}

function callsTo(calls: Call[], method: string, path: string): Call[] {
  return calls.filter((c) => c.method === method && c.path === path);
}

describe("J015 찾기 화면의 요청 중 상태", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("검색 중에는 '검색' 버튼이 막히고 '검색 중…'이 보이며, 질문은 따로 할 수 있고, 응답이 오면 풀린다", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    stubApi({ search: () => pending.promise, ask: () => json(askResult) });
    render(<App />);

    await openSearch(user);
    await user.type(textbox("검색어") as HTMLElement, "배포");
    await user.click(button("검색") as HTMLElement);

    await waitForElement(() => screen.queryByText("검색 중…"));
    expect(button("검색")?.disabled).toBe(true);
    await user.type(textbox("질문") as HTMLElement, "배포는 언제?");
    expect(button("질문")?.disabled).toBe(false);
    expect(screen.queryByText("답변을 만드는 중…")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(json(searchResultWith("검색 화면 개선")));
    });
    await waitForElement(() => region("노트 결과"));
    expect(screen.queryByText("검색 중…")).not.toBeInTheDocument();
    expect(button("검색")?.disabled).toBe(false);
  });

  it("질문 중에는 '질문' 버튼이 막히고 '답변을 만드는 중…'이 보이며, 응답이 오면 풀린다", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    stubApi({ ask: () => pending.promise });
    render(<App />);

    await openSearch(user);
    await user.type(textbox("질문") as HTMLElement, "배포는 언제?");
    await user.click(button("질문") as HTMLElement);

    await waitForElement(() => screen.queryByText("답변을 만드는 중…"));
    expect(button("질문")?.disabled).toBe(true);
    await user.type(textbox("검색어") as HTMLElement, "배포");
    expect(button("검색")?.disabled).toBe(false);
    expect(screen.queryByText("검색 중…")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(json(askResult));
    });
    await waitForElement(() => region("답변"));
    expect(screen.queryByText("답변을 만드는 중…")).not.toBeInTheDocument();
    expect(button("질문")?.disabled).toBe(false);
  });

  it("실패 응답이 와도 '검색 중…'·'답변을 만드는 중…'이 사라지고 버튼이 풀린다", async () => {
    const user = userEvent.setup();
    const searchReply = deferred();
    const askReply = deferred();
    stubApi({ search: () => searchReply.promise, ask: () => askReply.promise });
    render(<App />);

    await openSearch(user);
    await user.type(textbox("검색어") as HTMLElement, "배포");
    await user.click(button("검색") as HTMLElement);
    await user.type(textbox("질문") as HTMLElement, "배포는 언제?");
    await user.click(button("질문") as HTMLElement);
    await waitForElement(() => screen.queryByText("답변을 만드는 중…"));

    await act(async () => {
      searchReply.resolve(json({ detail: "boom" }, 500));
      askReply.resolve(json({ detail: { message: "모델 오류", problems: [] } }, 502));
    });
    await waitForElement(() => alertWith("질문하지 못했습니다"));
    await waitForElement(() => alertWith("검색하지 못했습니다"));
    expect(screen.queryByText("검색 중…")).not.toBeInTheDocument();
    expect(screen.queryByText("답변을 만드는 중…")).not.toBeInTheDocument();
    expect(button("검색")?.disabled).toBe(false);
    expect(button("질문")?.disabled).toBe(false);
  });

  it("새 검색을 시작하면 이전 검색 결과가 바로 사라진다", async () => {
    const user = userEvent.setup();
    const second = deferred();
    stubApi({
      search: sequence(
        () => json(searchResultWith("검색 화면 개선")),
        () => second.promise,
      ),
    });
    render(<App />);

    await openSearch(user);
    await user.type(textbox("검색어") as HTMLElement, "검색");
    await user.click(button("검색") as HTMLElement);
    await waitForElement(() => region("노트 결과"));

    await user.click(button("검색") as HTMLElement);
    await waitForElement(() => screen.queryByText("검색 중…"));
    expect(region("노트 결과")).not.toBeInTheDocument();
    expect(screen.queryByText("검색 화면 개선")).not.toBeInTheDocument();

    await act(async () => {
      second.resolve(json({ notes: [], decisions: [] }));
    });
    await waitForElement(() => screen.queryByText("없음"));
    expect(region("노트 결과")).not.toBeInTheDocument();
  });

  it("새 질문을 시작하면 이전 답변이 바로 사라진다", async () => {
    const user = userEvent.setup();
    const second = deferred();
    stubApi({ ask: sequence(() => json(askResult), () => second.promise) });
    render(<App />);

    await openSearch(user);
    await user.type(textbox("질문") as HTMLElement, "배포는 언제?");
    await user.click(button("질문") as HTMLElement);
    await waitForElement(() => region("답변"));

    await user.click(button("질문") as HTMLElement);
    await waitForElement(() => screen.queryByText("답변을 만드는 중…"));
    expect(region("답변")).not.toBeInTheDocument();
    expect(screen.queryByText("금요일에 배포하기로 했습니다")).not.toBeInTheDocument();

    await act(async () => {
      second.resolve(json({ answer: "없음", sources: [] }));
    });
    const answer = await waitForElement(() => region("답변"));
    expect(answer).toHaveTextContent(/^\s*없음\s*$/);
  });

  it("검색 오류와 질문 오류는 따로 보이고, 한쪽 요청이 다른 쪽 오류·결과를 지우지 않는다", async () => {
    const user = userEvent.setup();
    stubApi({
      search: sequence(
        () => json({ detail: "boom" }, 500),
        () => json(searchResultWith("검색 화면 개선")),
      ),
      ask: sequence(
        () =>
          json(
            { detail: { message: "모델 오류", problems: ["sources 형식이 틀렸습니다"] } },
            502,
          ),
        () => json(askResult),
      ),
    });
    render(<App />);

    await openSearch(user);
    await user.type(textbox("검색어") as HTMLElement, "배포");
    await user.click(button("검색") as HTMLElement);
    await waitForElement(() => alertWith("검색하지 못했습니다"));

    await user.type(textbox("질문") as HTMLElement, "배포는 언제?");
    await user.click(button("질문") as HTMLElement);
    const askAlert = await waitForElement(() => alertWith("질문하지 못했습니다"));
    const searchAlert = alertWith("검색하지 못했습니다") as HTMLElement;
    expect(searchAlert).not.toBeNull();
    expect(searchAlert).not.toBe(askAlert);
    expect(searchAlert).not.toHaveTextContent("질문하지 못했습니다");
    expect(askAlert).not.toHaveTextContent("검색하지 못했습니다");
    expect(askAlert).toHaveTextContent("sources 형식이 틀렸습니다");

    await user.click(button("질문") as HTMLElement);
    await waitForElement(() => region("답변"));
    expect(alertWith("질문하지 못했습니다")).toBeNull();
    expect(alertWith("검색하지 못했습니다")).not.toBeNull();

    await user.click(button("검색") as HTMLElement);
    await waitForElement(() => region("노트 결과"));
    expect(alertWith("검색하지 못했습니다")).toBeNull();
    expect(region("답변")).toHaveTextContent("금요일에 배포하기로 했습니다");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("검색 중에 폼을 다시 제출하면 새로 검색하고, 먼저 보낸 검색의 응답은 늦게 와도 버린다", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    const calls = stubApi({ search: sequence(() => first.promise, () => second.promise) });
    render(<App />);

    await openSearch(user);
    const input = textbox("검색어") as HTMLElement;
    await user.type(input, "첫째");
    await user.click(button("검색") as HTMLElement);
    await waitForElement(() => screen.queryByText("검색 중…"));
    await user.clear(input);
    await user.type(input, "둘째");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(callsTo(calls, "GET", "/api/search").map((c) => c.query)).toEqual(["첫째", "둘째"]),
    );

    await act(async () => {
      first.resolve(json(searchResultWith("첫째 결과")));
    });
    await settle();
    expect(screen.queryByText("첫째 결과")).not.toBeInTheDocument();
    expect(region("노트 결과")).not.toBeInTheDocument();
    expect(screen.queryByText("검색 중…")).toBeInTheDocument();

    await act(async () => {
      second.resolve(json(searchResultWith("둘째 결과")));
    });
    const notesRegion = await waitForElement(() => region("노트 결과"));
    await waitFor(() => expect(within(notesRegion).queryByText("둘째 결과")).not.toBeNull());
    expect(screen.queryByText("첫째 결과")).not.toBeInTheDocument();
    expect(screen.queryByText("검색 중…")).not.toBeInTheDocument();
  });

  it("질문 중에 폼을 다시 제출하면 새로 질문하고, 먼저 보낸 질문의 실패가 늦게 와도 버린다", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    const calls = stubApi({ ask: sequence(() => first.promise, () => second.promise) });
    render(<App />);

    await openSearch(user);
    const input = textbox("질문") as HTMLElement;
    await user.type(input, "첫 질문");
    await user.click(button("질문") as HTMLElement);
    await waitForElement(() => screen.queryByText("답변을 만드는 중…"));
    await user.clear(input);
    await user.type(input, "둘째 질문");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(callsTo(calls, "POST", "/api/ask").map((c) => c.body)).toEqual([
        { question: "첫 질문" },
        { question: "둘째 질문" },
      ]),
    );

    await act(async () => {
      second.resolve(json(askResult));
    });
    await waitForElement(() => region("답변"));
    expect(screen.queryByText("답변을 만드는 중…")).not.toBeInTheDocument();

    await act(async () => {
      first.resolve(json({ detail: { message: "늦은 오류", problems: [] } }, 502));
    });
    await settle();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(region("답변")).toHaveTextContent("금요일에 배포하기로 했습니다");
    expect(screen.queryByText("늦은 오류")).not.toBeInTheDocument();
  });
});
