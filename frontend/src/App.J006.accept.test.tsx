import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Note = { id: number; title: string; body: string; created_at: string };

const memo: Note = {
  id: 1,
  title: "아이디어 메모",
  body: "검색 화면 개선",
  created_at: "2026-10-22T08:00:00+00:00",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { method: string; path: string; body: unknown };

// 가짜 서버: POST /api/notes로 노트를 저장하고 GET은 최신순으로 돌려준다.
// failPost이면 POST에 500을 준다.
function stubApi(initialNotes: Note[], options: { failPost?: boolean } = {}) {
  const notes = initialNotes.map((n) => ({ ...n }));
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
    if (path === "/api/notes" && method === "POST") {
      if (options.failPost) {
        return json({ detail: "server error" }, 500);
      }
      const input = body as { title: string; body: string };
      const note: Note = {
        id: Math.max(0, ...notes.map((n) => n.id)) + 1,
        title: input.title,
        body: input.body,
        created_at: "2026-10-24T10:00:00+00:00",
      };
      notes.unshift(note);
      return json(note, 201);
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
  await waitFor(() => expect(query()).toBeInTheDocument());
  return query() as HTMLElement;
}

async function openNewNoteForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await waitForElement(() => screen.queryByRole("button", { name: "새 노트" })));
  const title = await waitForElement(() => screen.queryByRole("textbox", { name: "제목" }));
  const body = await waitForElement(() => screen.queryByRole("textbox", { name: "본문" }));
  return { title, body };
}

function posts(calls: Call[]): Call[] {
  return calls.filter((c) => c.method === "POST");
}

describe("J006 노트 작성 화면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("노트 목록 위에 '새 노트' 버튼이 있고 누르면 제목·본문 입력란과 저장·취소 버튼이 보인다", async () => {
    const user = userEvent.setup();
    stubApi([memo]);
    render(<App />);

    await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
    const newButton = await waitForElement(() =>
      screen.queryByRole("button", { name: "새 노트" }),
    );
    expect(newButton.closest("ul")).toBeNull();

    const { title, body } = await openNewNoteForm(user);
    expect(title.tagName).toBe("INPUT");
    expect(body.tagName).toBe("TEXTAREA");
    expect(screen.queryByRole("button", { name: "저장" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toHaveTextContent("서버 연결됨 (모델: fake)");
  });

  it("노트가 없을 때도 '새 노트' 버튼이 보인다", async () => {
    stubApi([]);
    render(<App />);

    await waitForElement(() => screen.queryByText("저장된 노트가 없습니다"));
    expect(screen.queryByRole("button", { name: "새 노트" })).toBeInTheDocument();
  });

  it("'저장'을 누르면 POST /api/notes로 저장하고 저장한 노트의 상세를 연다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo]);
    render(<App />);

    const { title, body } = await openNewNoteForm(user);
    await user.type(title, "주간 회의");
    await user.type(body, "결정: 다음 주 배포{enter}할 일: 릴리스 노트 작성");
    await user.click(screen.queryByRole("button", { name: "저장" }) as HTMLElement);

    await waitFor(() =>
      expect(posts(calls)).toEqual([
        {
          method: "POST",
          path: "/api/notes",
          body: { title: "주간 회의", body: "결정: 다음 주 배포\n할 일: 릴리스 노트 작성" },
        },
      ]),
    );
    await waitForElement(() => screen.queryByRole("heading", { name: "주간 회의" }));
    expect(screen.queryByText(/결정: 다음 주 배포/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "본문" })).not.toBeInTheDocument();

    await user.click(await waitForElement(() => screen.queryByRole("button", { name: "목록으로" })));
    await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
    expect(screen.queryByRole("button", { name: /아이디어 메모/ })).toBeInTheDocument();
  });

  it("본문이 비어 있으면 요청을 보내지 않는다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo]);
    render(<App />);

    const { title } = await openNewNoteForm(user);
    await user.type(title, "제목만 있음");
    const save = screen.queryByRole("button", { name: "저장" }) as HTMLElement;
    await user.click(save);

    await waitFor(() =>
      expect(
        (save as HTMLButtonElement).disabled || screen.queryByText("본문을 입력하세요") !== null,
      ).toBe(true),
    );
    expect(posts(calls)).toEqual([]);
    expect(screen.queryByRole("textbox", { name: "제목" })).toHaveValue("제목만 있음");
  });

  it("서버가 오류를 돌려주면 '저장하지 못했습니다'를 보여 주고 입력한 내용을 지우지 않는다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo], { failPost: true });
    render(<App />);

    const { title, body } = await openNewNoteForm(user);
    await user.type(title, "실패할 노트");
    await user.type(body, "본문 내용");
    await user.click(screen.queryByRole("button", { name: "저장" }) as HTMLElement);

    await waitForElement(() => screen.queryByText("저장하지 못했습니다"));
    expect(posts(calls)).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "제목" })).toHaveValue("실패할 노트");
    expect(screen.queryByRole("textbox", { name: "본문" })).toHaveValue("본문 내용");
    expect(screen.queryByRole("heading", { name: "실패할 노트" })).not.toBeInTheDocument();
  });

  it("'취소'를 누르면 요청 없이 노트 목록으로 돌아간다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo]);
    render(<App />);

    const { body } = await openNewNoteForm(user);
    await user.type(body, "쓰다가 그만둔 메모");
    await user.click(screen.queryByRole("button", { name: "취소" }) as HTMLElement);

    await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
    expect(screen.queryByRole("textbox", { name: "본문" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "새 노트" })).toBeInTheDocument();
    expect(posts(calls)).toEqual([]);
  });

  it("'할 일' 탭에는 '새 노트' 버튼이 없고 '노트' 탭으로 돌아오면 다시 보인다", async () => {
    const user = userEvent.setup();
    stubApi([memo]);
    render(<App />);

    await waitForElement(() => screen.queryByRole("button", { name: "새 노트" }));
    await user.click(screen.queryByRole("button", { name: "할 일" }) as HTMLElement);
    await waitForElement(() => screen.queryByText("할 일이 없습니다"));
    expect(screen.queryByRole("button", { name: "새 노트" })).not.toBeInTheDocument();

    await user.click(screen.queryByRole("button", { name: "노트" }) as HTMLElement);
    await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
    expect(screen.queryByRole("button", { name: "새 노트" })).toBeInTheDocument();
  });
});
