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

// 저장 응답을 테스트가 직접 풀어줄 때까지 붙잡아 두는 가짜 서버.
function stubApi() {
  const saves: unknown[] = [];
  let release: (() => void) | null = null;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/organize" && method === "POST") {
      return json({ summary: "요약", decisions: ["결정 하나"], todos: [] });
    }
    if (path === "/api/organized" && method === "POST") {
      saves.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      const note: Note = { id: 2, title: "새", body: "원문", created_at: "2026-10-25T10:00:00+00:00" };
      return json({ note, summary: "요약", decisions: [], todos: [] }, 201);
    }
    if (path === "/api/notes" && method === "GET") {
      return json([memo]);
    }
    if (/^\/api\/notes\/\d+$/.test(path) && method === "GET") {
      return json(memo);
    }
    if (path === "/api/todos" && method === "GET") {
      return json([]);
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    saves,
    release: () => release?.(),
  };
}

describe("J009 정리 저장 중복 방지", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("저장 중에는 '저장' 버튼이 막혀 빠르게 두 번 눌러도 POST /api/organized가 한 번만 간다", async () => {
    const user = userEvent.setup();
    const api = stubApi();
    render(<App />);

    await waitFor(() => expect(screen.queryByRole("button", { name: /아이디어 메모/ })).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "정리" }));
    await user.type(screen.getByRole("textbox", { name: "원문" }), "원문");
    await user.click(screen.getByRole("button", { name: "정리" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "요약" })).not.toBeNull());

    const save = screen.getByRole("button", { name: "저장" }) as HTMLButtonElement;
    await user.dblClick(save);

    await waitFor(() => expect(api.saves).toHaveLength(1));
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(api.saves).toHaveLength(1);

    api.release();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "요약" })).toBeNull());
    expect(api.saves).toHaveLength(1);
  });
});
