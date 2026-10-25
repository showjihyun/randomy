import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Note = { id: number; title: string; body: string; created_at: string };
type OrganizeResult = {
  summary: string;
  decisions: string[];
  todos: { task: string; owner: string | null; due: string | null }[];
};

const memo: Note = {
  id: 1,
  title: "아이디어 메모",
  body: "검색 화면 개선",
  created_at: "2026-10-22T08:00:00+00:00",
};

const RAW = "주간 회의 메모";

const result: OrganizeResult = {
  summary: "배포 일정을 정했다",
  decisions: ["금요일에 배포한다", "QA는 목요일까지 끝낸다"],
  todos: [
    { task: "릴리스 노트 작성", owner: "민수", due: "2026-10-30" },
    { task: "점검표 준비", owner: null, due: null },
  ],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { method: string; path: string; body: unknown };

type Options = {
  organize?: () => Response | Promise<Response>;
  saveStatus?: number;
};

// 가짜 서버: /api/organize는 options.organize(기본: result)를 돌려주고,
// POST /api/organized는 노트를 만들어 GET /api/notes·/api/notes/{id}에 보이게 한다.
function stubApi(initialNotes: Note[], options: Options = {}) {
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
    if (path === "/api/organize" && method === "POST") {
      return options.organize ? options.organize() : json(result);
    }
    if (path === "/api/organized" && method === "POST") {
      if (options.saveStatus !== undefined) {
        return json(
          { detail: { message: "저장 검사 실패", problems: ["todos[0].task가 비었습니다"] } },
          options.saveStatus,
        );
      }
      const input = body as { title: string; body: string; summary: string };
      const note: Note = {
        id: Math.max(0, ...notes.map((n) => n.id)) + 1,
        title: input.title,
        body: input.body,
        created_at: "2026-10-25T10:00:00+00:00",
      };
      notes.unshift(note);
      return json({ note, summary: input.summary, decisions: [], todos: [] }, 201);
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
// jest-dom 매처의 실패 메시지는 색 코드로 시작할 수 있어 vitest 기본 매처(AssertionError)를 쓴다.
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

async function openOrganize(user: ReturnType<typeof userEvent.setup>) {
  await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
  await user.click(await waitForElement(() => button("정리")));
  return waitForElement(() => textbox("원문"));
}

async function organizeRaw(user: ReturnType<typeof userEvent.setup>) {
  const raw = await openOrganize(user);
  await user.type(raw, RAW);
  await user.click(button("정리") as HTMLElement);
  await waitForElement(() => textbox("요약"));
  return raw;
}

function postsTo(calls: Call[], path: string): Call[] {
  return calls.filter((c) => c.method === "POST" && c.path === path);
}

describe("J009 정리 화면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("노트 탭에 '정리' 진입점이 있고 누르면 원문 입력칸과 '정리' 버튼이 보인다", async () => {
    const user = userEvent.setup();
    stubApi([memo]);
    render(<App />);

    const raw = await openOrganize(user);
    expect(raw.tagName).toBe("TEXTAREA");
    expect(screen.queryAllByRole("button", { name: "정리" })).toHaveLength(1);
    expect(button("새 노트")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /아이디어 메모/ })).not.toBeInTheDocument();

    await user.click(button("노트") as HTMLElement);
    await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
    expect(textbox("원문")).not.toBeInTheDocument();
  });

  it("'할 일' 탭에는 '정리' 진입점이 없다", async () => {
    const user = userEvent.setup();
    stubApi([memo]);
    render(<App />);

    await waitForElement(() => button("정리"));
    await user.click(button("할 일") as HTMLElement);
    await waitForElement(() => screen.queryByText("할 일이 없습니다"));
    expect(button("정리")).not.toBeInTheDocument();
  });

  it("원문이 비어 있으면 '정리' 버튼이 막혀 있고 요청을 보내지 않는다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo]);
    render(<App />);

    const raw = await openOrganize(user);
    const organize = button("정리") as HTMLButtonElement;
    expect(organize.disabled).toBe(true);
    await user.type(raw, "   ");
    expect(organize.disabled).toBe(true);
    await user.click(organize);
    expect(postsTo(calls, "/api/organize")).toEqual([]);

    await user.type(raw, "메모");
    expect((button("정리") as HTMLButtonElement).disabled).toBe(false);
  });

  it("'정리'를 누르면 POST /api/organize를 부르고 요약·결정 사항·할 일이 입력칸으로 보인다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo]);
    render(<App />);

    const raw = await organizeRaw(user);

    expect(postsTo(calls, "/api/organize")).toEqual([
      { method: "POST", path: "/api/organize", body: { text: RAW } },
    ]);
    expect(textbox("제목")).toHaveValue("");
    expect(textbox("요약")).toHaveValue("배포 일정을 정했다");
    expect(textbox("결정 1")).toHaveValue("금요일에 배포한다");
    expect(textbox("결정 2")).toHaveValue("QA는 목요일까지 끝낸다");
    expect(textbox("할 일 1")).toHaveValue("릴리스 노트 작성");
    expect(textbox("담당 1")).toHaveValue("민수");
    expect(textbox("기한 1")).toHaveValue("2026-10-30");
    expect(textbox("할 일 2")).toHaveValue("점검표 준비");
    expect(textbox("담당 2")).toHaveValue("");
    expect(textbox("기한 2")).toHaveValue("");
    expect(button("결정 1 삭제")).toBeInTheDocument();
    expect(button("할 일 1 삭제")).toBeInTheDocument();
    expect(button("결정 추가")).toBeInTheDocument();
    expect(button("할 일 추가")).toBeInTheDocument();
    expect(button("저장")).toBeInTheDocument();
    expect(raw).toHaveValue(RAW);
    expect(screen.queryByText("없음")).not.toBeInTheDocument();
  });

  it("정리 중에는 '정리' 버튼이 막혀 있다", async () => {
    const user = userEvent.setup();
    let respond: (response: Response) => void = () => undefined;
    stubApi([memo], {
      organize: () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    });
    render(<App />);

    const raw = await openOrganize(user);
    await user.type(raw, RAW);
    await user.click(button("정리") as HTMLElement);

    await waitFor(() => expect((button("정리") as HTMLButtonElement).disabled).toBe(true));
    respond(json(result));
    await waitForElement(() => textbox("요약"));
    expect((button("정리") as HTMLButtonElement).disabled).toBe(false);
  });

  it("결정 하나를 지우고 할 일의 담당을 고친 뒤 저장하면 고친 값으로 POST /api/organized를 한 번 부르고 노트 상세를 연다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo]);
    render(<App />);

    await organizeRaw(user);
    await user.type(textbox("제목") as HTMLElement, "주간 회의");
    await user.type(textbox("요약") as HTMLElement, " (수정)");
    await user.click(button("결정 1 삭제") as HTMLElement);
    expect(textbox("결정 1")).toHaveValue("QA는 목요일까지 끝낸다");
    expect(textbox("결정 2")).not.toBeInTheDocument();
    const owner = textbox("담당 1") as HTMLElement;
    await user.clear(owner);
    await user.type(owner, "지현");
    await user.click(button("저장") as HTMLElement);

    await waitFor(() =>
      expect(postsTo(calls, "/api/organized")).toEqual([
        {
          method: "POST",
          path: "/api/organized",
          body: {
            title: "주간 회의",
            body: RAW,
            summary: "배포 일정을 정했다 (수정)",
            decisions: ["QA는 목요일까지 끝낸다"],
            todos: [
              { task: "릴리스 노트 작성", owner: "지현", due: "2026-10-30" },
              { task: "점검표 준비", owner: null, due: null },
            ],
          },
        },
      ]),
    );
    await waitForElement(() => screen.queryByRole("heading", { name: "주간 회의" }));
    expect(textbox("요약")).not.toBeInTheDocument();
    expect(screen.queryByText(RAW)).toBeInTheDocument();

    await user.click(await waitForElement(() => button("목록으로")));
    await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
    expect(screen.queryByRole("button", { name: /아이디어 메모/ })).toBeInTheDocument();
  });

  it("결정·할 일을 지우고 추가하면 저장 본문 끝에 새 항목이 들어간다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo]);
    render(<App />);

    await organizeRaw(user);
    await user.click(button("할 일 2 삭제") as HTMLElement);
    expect(textbox("할 일 2")).not.toBeInTheDocument();
    await user.click(button("결정 추가") as HTMLElement);
    await user.type(await waitForElement(() => textbox("결정 3")), "회고는 생략한다");
    await user.click(button("할 일 추가") as HTMLElement);
    await user.type(await waitForElement(() => textbox("할 일 2")), "회의실 예약");
    await user.type(textbox("기한 2") as HTMLElement, "2026-10-27");
    await user.click(button("저장") as HTMLElement);

    await waitFor(() => expect(postsTo(calls, "/api/organized")).toHaveLength(1));
    expect(postsTo(calls, "/api/organized")[0].body).toEqual({
      title: "",
      body: RAW,
      summary: "배포 일정을 정했다",
      decisions: ["금요일에 배포한다", "QA는 목요일까지 끝낸다", "회고는 생략한다"],
      todos: [
        { task: "릴리스 노트 작성", owner: "민수", due: "2026-10-30" },
        { task: "회의실 예약", owner: null, due: "2026-10-27" },
      ],
    });
  });

  it("결정·할 일이 빈 결과면 '없음'이 보이고, 다 지워도 '없음'이 보인다", async () => {
    const user = userEvent.setup();
    stubApi([memo], { organize: () => json({ summary: "", decisions: [], todos: [] }) });
    render(<App />);

    await organizeRaw(user);
    expect(screen.queryAllByText("없음")).toHaveLength(2);
    expect(textbox("결정 1")).not.toBeInTheDocument();
    expect(textbox("할 일 1")).not.toBeInTheDocument();

    await user.click(button("결정 추가") as HTMLElement);
    await waitForElement(() => textbox("결정 1"));
    expect(screen.queryAllByText("없음")).toHaveLength(1);
    await user.click(button("결정 1 삭제") as HTMLElement);
    expect(screen.queryAllByText("없음")).toHaveLength(2);
  });

  it("/api/organize가 502를 돌려주면 message와 problems를 보여 주고 원문을 지우지 않는다", async () => {
    const user = userEvent.setup();
    stubApi([memo], {
      organize: () =>
        json(
          {
            detail: {
              message: "모델 출력이 형식에 맞지 않습니다",
              problems: ["summary 필드가 없습니다", "todos 필드가 없습니다"],
            },
          },
          502,
        ),
    });
    render(<App />);

    const raw = await openOrganize(user);
    await user.type(raw, RAW);
    await user.click(button("정리") as HTMLElement);

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("정리하지 못했습니다");
    expect(alert).toHaveTextContent("모델 출력이 형식에 맞지 않습니다");
    expect(alert).toHaveTextContent("summary 필드가 없습니다");
    expect(alert).toHaveTextContent("todos 필드가 없습니다");
    expect(textbox("원문")).toHaveValue(RAW);
    expect(textbox("요약")).not.toBeInTheDocument();
    expect((button("정리") as HTMLButtonElement).disabled).toBe(false);
  });

  it("/api/organize가 422를 돌려주면 오류를 보여 주고 원문을 지우지 않는다", async () => {
    const user = userEvent.setup();
    stubApi([memo], {
      organize: () =>
        json({ detail: [{ type: "string_too_short", loc: ["body", "text"], msg: "too short" }] }, 422),
    });
    render(<App />);

    const raw = await openOrganize(user);
    await user.type(raw, RAW);
    await user.click(button("정리") as HTMLElement);

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("정리하지 못했습니다");
    expect(textbox("원문")).toHaveValue(RAW);
    expect(textbox("요약")).not.toBeInTheDocument();
  });

  it("저장이 실패하면 '저장하지 못했습니다'를 보여 주고 편집한 값을 남긴다", async () => {
    const user = userEvent.setup();
    const calls = stubApi([memo], { saveStatus: 422 });
    render(<App />);

    await organizeRaw(user);
    await user.type(textbox("제목") as HTMLElement, "실패할 정리");
    await user.click(button("저장") as HTMLElement);

    const alert = await waitForElement(() => screen.queryByRole("alert"));
    expect(alert).toHaveTextContent("저장하지 못했습니다");
    expect(alert).toHaveTextContent("todos[0].task가 비었습니다");
    expect(postsTo(calls, "/api/organized")).toHaveLength(1);
    expect(textbox("제목")).toHaveValue("실패할 정리");
    expect(textbox("결정 1")).toHaveValue("금요일에 배포한다");
    expect(textbox("원문")).toHaveValue(RAW);
    expect(screen.queryByRole("heading", { name: "실패할 정리" })).not.toBeInTheDocument();
  });
});
