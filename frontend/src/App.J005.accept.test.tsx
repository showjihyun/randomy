import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Note = { id: number; title: string; body: string; created_at: string };
type Todo = {
  id: number;
  note_id: number;
  task: string;
  owner: string | null;
  due: string | null;
  done: boolean;
  created_at: string;
};

const weekly: Note = {
  id: 2,
  title: "주간 회의",
  body: "결정: 다음 주 배포. 할 일: 릴리스 노트 작성",
  created_at: "2026-10-23T09:30:00+00:00",
};
const memo: Note = {
  id: 1,
  title: "아이디어 메모",
  body: "검색 화면 개선",
  created_at: "2026-10-22T08:00:00+00:00",
};

function makeTodos(): Todo[] {
  return [
    {
      id: 3,
      note_id: 2,
      task: "릴리스 노트 작성",
      owner: "민수",
      due: "2026-10-30",
      done: false,
      created_at: "2026-10-23T10:00:00+00:00",
    },
    {
      id: 2,
      note_id: 1,
      task: "검색 화면 시안 만들기",
      owner: null,
      due: null,
      done: false,
      created_at: "2026-10-22T09:00:00+00:00",
    },
    {
      id: 1,
      note_id: 2,
      task: "배포 일정 공유",
      owner: "지은",
      due: null,
      done: true,
      created_at: "2026-10-23T09:40:00+00:00",
    },
  ];
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { method: string; path: string; body: unknown };

// 가짜 서버: 할 일 상태를 들고 있다가 PATCH로 바꾸고, GET은 완료 안 된 것 먼저 돌려준다.
function stubApi(notes: Note[], initialTodos: Todo[]) {
  const todos = initialTodos.map((t) => ({ ...t }));
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, path, body });
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/notes") {
      return json(notes);
    }
    const noteMatch = /^\/api\/notes\/(\d+)$/.exec(path);
    if (noteMatch) {
      const note = notes.find((n) => n.id === Number(noteMatch[1]));
      return note ? json(note) : json({ detail: "Not Found" }, 404);
    }
    if (path === "/api/todos" && method === "GET") {
      return json([...todos.filter((t) => !t.done), ...todos.filter((t) => t.done)]);
    }
    const todoMatch = /^\/api\/todos\/(\d+)$/.exec(path);
    if (todoMatch && method === "PATCH") {
      const todo = todos.find((t) => t.id === Number(todoMatch[1]));
      if (!todo) {
        return json({ detail: "Not Found" }, 404);
      }
      todo.done = (body as { done: boolean }).done;
      return json(todo);
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForElement(query: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(query()).toBeInTheDocument());
  return query() as HTMLElement;
}

async function openTodosTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await waitForElement(() => screen.queryByRole("button", { name: "할 일" })));
}

describe("J005 할 일 목록 화면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'노트'·'할 일' 탭이 있고 첫 화면은 노트 목록이다", async () => {
    stubApi([weekly, memo], makeTodos());
    render(<App />);

    await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
    expect(screen.queryByRole("button", { name: "노트" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "할 일" })).toBeInTheDocument();
    expect(screen.queryByText("릴리스 노트 작성")).not.toBeInTheDocument();
  });

  it("'할 일' 탭에서 받은 순서대로 내용·담당·기한·체크박스를 보여 주고 완료된 것은 줄을 긋는다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([weekly, memo], makeTodos());
    render(<App />);

    await openTodosTab(user);
    await waitForElement(() => screen.queryByText("릴리스 노트 작성"));
    expect(calls.some((c) => c.method === "GET" && c.path === "/api/todos")).toBe(true);

    const items = screen.queryAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("릴리스 노트 작성");
    expect(items[0]).toHaveTextContent("담당: 민수");
    expect(items[0]).toHaveTextContent("기한: 2026-10-30");
    expect(items[1]).toHaveTextContent("검색 화면 시안 만들기");
    expect(items[1]).not.toHaveTextContent("담당:");
    expect(items[1]).not.toHaveTextContent("기한:");
    expect(items[2]).toHaveTextContent("배포 일정 공유");
    expect(items[2]).toHaveTextContent("담당: 지은");
    expect(items[2]).not.toHaveTextContent("기한:");

    expect(screen.queryByRole("checkbox", { name: /릴리스 노트 작성/ })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /검색 화면 시안 만들기/ })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /배포 일정 공유/ })).toBeChecked();

    expect(screen.queryByText("배포 일정 공유")?.closest("s")).not.toBeNull();
    expect(screen.queryByText("릴리스 노트 작성")?.closest("s")).toBeNull();
    expect(screen.queryByText("검색 화면 시안 만들기")?.closest("s")).toBeNull();

    for (const item of items) {
      expect(within(item).queryByRole("button", { name: "원본 노트" })).toBeInTheDocument();
    }
    expect(screen.queryByRole("status")).toHaveTextContent("서버 연결됨 (모델: fake)");
  });

  it("체크박스를 바꾸면 PATCH로 완료 표시를 바꾸고 목록을 다시 불러온다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([weekly, memo], makeTodos());
    render(<App />);

    await openTodosTab(user);
    const checkbox = await waitForElement(() =>
      screen.queryByRole("checkbox", { name: /릴리스 노트 작성/ }),
    );
    const getsBefore = calls.filter((c) => c.method === "GET" && c.path === "/api/todos").length;

    await user.click(checkbox);

    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PATCH")).toEqual([
        { method: "PATCH", path: "/api/todos/3", body: { done: true } },
      ]),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "GET" && c.path === "/api/todos").length).toBe(
        getsBefore + 1,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("릴리스 노트 작성")?.closest("s")).not.toBeNull(),
    );
    expect(screen.queryByRole("checkbox", { name: /릴리스 노트 작성/ })).toBeChecked();

    const items = screen.queryAllByRole("listitem");
    expect(items[0]).toHaveTextContent("검색 화면 시안 만들기");
    expect(items[1]).toHaveTextContent("릴리스 노트 작성");

    await user.click(screen.queryByRole("checkbox", { name: /배포 일정 공유/ }) as HTMLElement);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PATCH")).toContainEqual({
        method: "PATCH",
        path: "/api/todos/1",
        body: { done: false },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("배포 일정 공유")?.closest("s")).toBeNull(),
    );
  });

  it("'원본 노트'를 누르면 노트 탭으로 바뀌고 그 노트의 상세를 연다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([weekly, memo], makeTodos());
    render(<App />);

    await openTodosTab(user);
    await waitForElement(() => screen.queryByText("검색 화면 시안 만들기"));
    const item = screen.queryAllByRole("listitem")[1];
    await user.click(
      await waitForElement(() => within(item).queryByRole("button", { name: "원본 노트" })),
    );

    await waitForElement(() => screen.queryByRole("heading", { name: "아이디어 메모" }));
    expect(screen.queryByText(memo.body)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "GET" && c.path === "/api/notes/1")).toBe(true);
    expect(screen.queryByText("검색 화면 시안 만들기")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(await waitForElement(() => screen.queryByRole("button", { name: "목록으로" })));
    await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
    expect(screen.queryByRole("button", { name: /아이디어 메모/ })).toBeInTheDocument();
  });

  it("할 일이 없으면 '할 일이 없습니다'를 보여 주고 '노트' 탭으로 돌아가면 노트 목록이 보인다", async () => {
    const user = userEvent.setup();
    stubApi([weekly, memo], []);
    render(<App />);

    await openTodosTab(user);
    await waitForElement(() => screen.queryByText("할 일이 없습니다"));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /주간 회의/ })).not.toBeInTheDocument();

    await user.click(screen.queryByRole("button", { name: "노트" }) as HTMLElement);
    await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
    expect(screen.queryByText("할 일이 없습니다")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("status")).toHaveTextContent("서버 연결됨 (모델: fake)");
  });
});
