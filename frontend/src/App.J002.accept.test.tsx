import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Note = { id: number; title: string; body: string; created_at: string };

const newer: Note = {
  id: 2,
  title: "주간 회의",
  body: "결정: 다음 주 배포. 할 일: 릴리스 노트 작성",
  created_at: "2026-10-23T09:30:00+00:00",
};
const older: Note = {
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

function stubApi(notes: Note[], detailStatus = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/notes") {
      return json(notes);
    }
    const match = /^\/api\/notes\/(\d+)$/.exec(path);
    if (match) {
      const note = notes.find((n) => n.id === Number(match[1]));
      if (detailStatus !== 200 || !note) {
        return json({ detail: "Not Found" }, 404);
      }
      return json(note);
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calledPaths(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls.map(([input]) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url, "http://localhost").pathname;
  });
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForElement(query: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(query()).toBeInTheDocument());
  return query() as HTMLElement;
}

describe("J002 노트 목록·상세 화면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("첫 화면에 노트 제목과 작성 시각을 최신순 목록으로 보여 주고 서버 연결 표시를 유지한다", async () => {
    const fetchMock = stubApi([newer, older]);
    render(<App />);

    await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
    expect(screen.queryByRole("button", { name: /아이디어 메모/ })).toBeInTheDocument();

    const items = screen.queryAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("주간 회의");
    expect(items[0]).toHaveTextContent(newer.created_at);
    expect(items[1]).toHaveTextContent("아이디어 메모");
    expect(items[1]).toHaveTextContent(older.created_at);

    expect(calledPaths(fetchMock)).toContain("/api/notes");
    await waitForElement(() => screen.queryByText("서버 연결됨 (모델: fake)"));
    expect(screen.queryByRole("heading", { name: "Randomy" })).toBeInTheDocument();
  });

  it("노트가 없으면 '저장된 노트가 없습니다'를 보여 준다", async () => {
    stubApi([]);
    render(<App />);

    await waitForElement(() => screen.queryByText("저장된 노트가 없습니다"));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("노트를 누르면 상세를 불러와 보여 주고 '목록으로'로 돌아간다", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi([newer, older]);
    render(<App />);

    await user.click(await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ })));

    await waitForElement(() => screen.queryByRole("heading", { name: "주간 회의" }));
    expect(screen.queryByText(newer.body)).toBeInTheDocument();
    expect(screen.queryByText(newer.created_at)).toBeInTheDocument();
    expect(calledPaths(fetchMock)).toContain("/api/notes/2");
    expect(screen.queryByRole("button", { name: /아이디어 메모/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).toHaveTextContent("서버 연결됨 (모델: fake)");

    await user.click(await waitForElement(() => screen.queryByRole("button", { name: "목록으로" })));

    await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
    expect(screen.queryByRole("button", { name: /주간 회의/ })).toBeInTheDocument();
    expect(screen.queryByText(newer.body)).not.toBeInTheDocument();
  });

  it("상세를 불러오지 못하면 '노트를 찾을 수 없습니다'를 보여 주고 목록으로 돌아갈 수 있다", async () => {
    const user = userEvent.setup();
    stubApi([newer, older], 404);
    render(<App />);

    await user.click(await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ })));

    await waitForElement(() => screen.queryByText("노트를 찾을 수 없습니다"));
    expect(screen.queryByText(newer.body)).not.toBeInTheDocument();

    await user.click(await waitForElement(() => screen.queryByRole("button", { name: "목록으로" })));

    const list = await waitForElement(() => screen.queryByRole("list"));
    expect(within(list).queryByRole("button", { name: /아이디어 메모/ })).toBeInTheDocument();
    expect(screen.queryByText("노트를 찾을 수 없습니다")).not.toBeInTheDocument();
  });
});
