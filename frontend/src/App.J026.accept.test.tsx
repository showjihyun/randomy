import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type FormatModule = { formatDateTime?: (iso: string) => string };

// 정적 import는 모듈이 없을 때 assertion이 아닌 오류가 되므로 glob으로 읽는다.
const formatModules = import.meta.glob<FormatModule>("./lib/format.ts", { eager: true });

function formatDateTime(iso: string): string | undefined {
  return formatModules["./lib/format.ts"]?.formatDateTime?.(iso);
}

// 글자가 실행 환경의 시간대에 따라 달라지므로 기대값을 같은 방법으로 계산한다.
function displayed(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

const note = {
  id: 2,
  title: "주간 회의",
  body: "결정: 다음 주 배포",
  created_at: "2026-11-08T08:20:40+00:00",
};

const wordDueTodo = {
  id: 2,
  note_id: 2,
  task: "릴리스 노트 작성",
  owner: null,
  due: "금요일",
  done: false,
  created_at: "2026-11-08T09:00:00+00:00",
};

const dateDueTodo = {
  id: 1,
  note_id: 2,
  task: "배포 일정 공유",
  owner: null,
  due: "2026-10-30",
  done: false,
  created_at: "2026-11-08T09:10:00+00:00",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/notes") {
      return json([note]);
    }
    if (path === `/api/notes/${note.id}`) {
      return json(note);
    }
    if (path === "/api/todos") {
      return json([wordDueTodo, dateDueTodo]);
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

async function renderRow() {
  const user = userEvent.setup();
  stubApi();
  render(<App />);
  const row = await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
  return { user, row };
}

function expectNoteTime(time: Element | null) {
  expect(time?.textContent).toBe(displayed(note.created_at));
  expect(time?.getAttribute("datetime")).toBe(note.created_at);
}

describe("J026 formatDateTime", () => {
  it("ISO 시각을 ko-KR 날짜·시각 형식으로 바꾼다", () => {
    const iso = "2026-11-08T08:20:40+00:00";

    expect(formatDateTime(iso)).toBe(displayed(iso));
  });

  it("잘못된 날짜 문자열은 받은 문자열을 그대로 돌려준다", () => {
    expect(formatDateTime("잘못된 값")).toBe("잘못된 값");
  });
});

describe("J026 노트 저장 시각 표시", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("노트 목록 행의 time은 표시 형식 글자이고 dateTime 속성은 ISO 원문이다", async () => {
    const { row } = await renderRow();

    expectNoteTime(row.querySelector("time"));
  });

  it("노트 상세의 time은 표시 형식 글자이고 dateTime 속성은 ISO 원문이다", async () => {
    const { user, row } = await renderRow();
    await user.click(row);
    await waitForElement(() => screen.queryByRole("heading", { name: note.title, level: 2 }));

    expectNoteTime(document.querySelector("main time"));
  });

  it("노트 시각만 표시 형식으로 바뀌고 할 일 기한 배지는 입력한 글자 그대로다", async () => {
    const { user, row } = await renderRow();
    expectNoteTime(row.querySelector("time"));

    await user.click(screen.queryByRole("button", { name: "할 일" }) as HTMLElement);
    await waitForElement(() => screen.queryByText(wordDueTodo.task));

    const items = screen.queryAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).queryByText("기한: 금요일")).not.toBeNull();
    expect(within(items[1]).queryByText("기한: 2026-10-30")).not.toBeNull();
  });
});
