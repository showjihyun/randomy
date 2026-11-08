import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const CARD = '[data-slot="card"]';

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

const searchResult = {
  notes: [{ id: 2, title: "아이디어 메모", snippet: "검색 화면 개선", created_at: memo.created_at }],
  decisions: [
    {
      id: 7,
      note_id: 1,
      note_title: "주간 회의",
      text: "금요일에 배포한다",
      created_at: meeting.created_at,
    },
  ],
};

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

function deferred() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stubApi(options: { search?: Reply; ask?: Reply } = {}) {
  const notes = [memo, meeting];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
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
      if (path === "/api/todos" && method === "GET") {
        return json([]);
      }
      return json({ detail: "Not Found" }, 404);
    }),
  );
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForElement(query: () => HTMLElement | null): Promise<HTMLElement> {
  await waitFor(() => expect(query()).not.toBeNull());
  return query() as HTMLElement;
}

function textbox(name: string): HTMLInputElement {
  return screen.queryByRole("textbox", { name }) as HTMLInputElement;
}

function button(name: string): HTMLButtonElement {
  return screen.queryByRole("button", { name }) as HTMLButtonElement;
}

function region(name: string): HTMLElement | null {
  return screen.queryByRole("region", { name });
}

function alertWith(text: string): HTMLElement | null {
  return screen.queryAllByRole("alert").find((el) => el.textContent?.includes(text)) ?? null;
}

// 영역이 Card 자신이거나 안에 Card를 가지면 그 Card를 돌려준다.
function cardOf(area: HTMLElement): Element | null {
  return area.matches(CARD) ? area : area.querySelector(CARD);
}

function spinnerIn(element: HTMLElement): Element | null {
  return element.querySelector("svg.animate-spin");
}

function expectBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

function expectInDashedArea(element: HTMLElement) {
  const area = element.closest(".border-dashed");
  expect(area).not.toBeNull();
  expect(area).toHaveClass("rounded-lg", "text-center");
}

function expectFormRow(form: HTMLFormElement, input: HTMLElement, submit: HTMLElement) {
  const row = [form, ...Array.from(form.querySelectorAll("*"))].find((el) =>
    el.classList.contains("sm:flex-row"),
  );
  expect(row).toBeDefined();
  expect(row?.contains(input)).toBe(true);
  expect(row?.contains(submit)).toBe(true);
}

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await waitForElement(() => screen.queryByRole("button", { name: /아이디어 메모/ }));
  await user.click(await waitForElement(() => button("찾기")));
  await waitForElement(() => textbox("검색어"));
}

async function runSearch(user: ReturnType<typeof userEvent.setup>, q: string) {
  await openSearch(user);
  await user.type(textbox("검색어"), q);
  await user.click(button("검색"));
}

async function runAsk(user: ReturnType<typeof userEvent.setup>, question: string) {
  await openSearch(user);
  await user.type(textbox("질문"), question);
  await user.click(button("질문"));
}

describe("J023 찾기 화면 디자인", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("검색 입력과 질문 입력은 Input이고 연결된 Label의 글자가 그대로다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await openSearch(user);

    for (const name of ["검색어", "질문"]) {
      const input = textbox(name);
      expect(input.getAttribute("data-slot")).toBe("input");
      const label = input.labels?.[0] as HTMLElement;
      expect(label.getAttribute("data-slot")).toBe("label");
      expect(label).toHaveTextContent(new RegExp(`^${name}$`));
    }
  });

  it("검색 폼과 질문 폼은 Card 하나에 위아래로 있고 사이에 Separator가 있다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await openSearch(user);

    const card = textbox("검색어").closest(CARD);
    expect(card).not.toBeNull();
    expect(textbox("질문").closest(CARD)).toBe(card);

    const searchForm = textbox("검색어").closest("form") as HTMLFormElement;
    const askForm = textbox("질문").closest("form") as HTMLFormElement;
    const separators = (card as Element).querySelectorAll('[data-slot="separator"]');
    expect(separators).toHaveLength(1);
    expectBefore(searchForm, separators[0]);
    expectBefore(separators[0], askForm);
  });

  it("각 폼의 제출 버튼은 Button default이고 입력과 버튼은 sm 이상에서 가로로 놓인다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await openSearch(user);

    for (const [inputName, buttonName] of [
      ["검색어", "검색"],
      ["질문", "질문"],
    ]) {
      const input = textbox(inputName);
      const submit = button(buttonName);
      const form = input.closest("form") as HTMLFormElement;
      expect(submit.getAttribute("data-slot")).toBe("button");
      expect(submit.getAttribute("data-variant")).toBe("default");
      expect(submit.getAttribute("type")).toBe("submit");
      expect(form.contains(submit)).toBe(true);
      expectFormRow(form, input, submit);
    }
  });

  it("검색 중에는 '검색' 버튼이 막히고 도는 아이콘이 보이며, 끝나면 사라진다", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    stubApi({ search: () => pending.promise });
    render(<App />);

    await runSearch(user, "배포");

    await waitForElement(() => screen.queryByText("검색 중…"));
    expect(button("검색").disabled).toBe(true);
    expect(spinnerIn(button("검색"))).not.toBeNull();
    expect(spinnerIn(button("질문"))).toBeNull();

    await act(async () => {
      pending.resolve(json(searchResult));
    });
    await waitForElement(() => region("노트 결과"));
    expect(spinnerIn(button("검색"))).toBeNull();
  });

  it("질문 중에는 '질문' 버튼이 막히고 도는 아이콘이 보이며, 끝나면 사라진다", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    stubApi({ ask: () => pending.promise });
    render(<App />);

    await runAsk(user, "배포는 언제?");

    await waitForElement(() => screen.queryByText("답변을 만드는 중…"));
    expect(button("질문").disabled).toBe(true);
    expect(spinnerIn(button("질문"))).not.toBeNull();
    expect(spinnerIn(button("검색"))).toBeNull();

    await act(async () => {
      pending.resolve(json(askResult));
    });
    await waitForElement(() => region("답변"));
    expect(spinnerIn(button("질문"))).toBeNull();
  });

  it("노트 결과와 결정 사항 결과는 각각 Card이고 행은 제목과 보조 글이 있는 ghost 버튼이다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await runSearch(user, "배포");

    const notesRegion = await waitForElement(() => region("노트 결과"));
    const decisionsRegion = await waitForElement(() => region("결정 사항 결과"));
    const notesCard = cardOf(notesRegion);
    const decisionsCard = cardOf(decisionsRegion);
    expect(notesCard).not.toBeNull();
    expect(decisionsCard).not.toBeNull();
    expect(notesCard).not.toBe(decisionsCard);

    const rows: [HTMLElement, string, string][] = [
      [within(notesRegion).queryAllByRole("button")[0], "아이디어 메모", "검색 화면 개선"],
      [within(decisionsRegion).queryAllByRole("button")[0], "금요일에 배포한다", "주간 회의"],
    ];
    for (const [row, title, detail] of rows) {
      expect(row.getAttribute("data-slot")).toBe("button");
      expect(row.getAttribute("data-variant")).toBe("ghost");
      expect(row).toHaveClass("h-auto", "whitespace-normal");
      expect(within(row).queryByText(title)).toHaveClass("font-medium");
      expect(within(row).queryByText(detail)).toHaveClass("text-xs", "text-muted-foreground");
    }
  });

  it("답변은 Card이고 본문 아래 '근거' 줄에 outline sm 버튼이 있다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await runAsk(user, "배포는 언제?");

    const answer = await waitForElement(() => region("답변"));
    expect(cardOf(answer)).not.toBeNull();

    const body = within(answer).queryByText(askResult.answer) as HTMLElement;
    expect(body).toHaveClass("text-sm", "leading-7");
    expect(body).not.toHaveClass("text-muted-foreground");

    const heading = within(answer).queryByText("근거") as HTMLElement;
    expect(heading).toHaveClass("text-xs", "text-muted-foreground");

    const source = within(answer).queryAllByRole("button")[0];
    expect(source.getAttribute("data-slot")).toBe("button");
    expect(source.getAttribute("data-variant")).toBe("outline");
    expect(source.getAttribute("data-size")).toBe("sm");
    expect(source).toHaveTextContent("주간 회의");
    expectBefore(body, heading);
    expectBefore(heading, source);
  });

  it("근거 없는 답변은 Card 안에 흐린 글자로 보이고 '근거' 줄이 없다", async () => {
    const user = userEvent.setup();
    stubApi({ ask: () => json({ answer: "없음", sources: [] }) });
    render(<App />);

    await runAsk(user, "점심 메뉴는?");

    const answer = await waitForElement(() => region("답변"));
    expect(cardOf(answer)).not.toBeNull();
    const body = within(answer).queryByText("없음") as HTMLElement;
    expect(body).toHaveClass("text-muted-foreground");
    expect(body.closest(".border-dashed")).toBeNull();
    expect(within(answer).queryByText("근거")).not.toBeInTheDocument();
  });

  it("검색 오류와 질문 오류는 destructive Alert이고 문구가 그대로다", async () => {
    const user = userEvent.setup();
    stubApi({
      search: () => json({ detail: "boom" }, 500),
      ask: () =>
        json({ detail: { message: "모델 오류", problems: ["sources 형식이 틀렸습니다"] } }, 502),
    });
    render(<App />);

    await runSearch(user, "배포");
    const searchAlert = await waitForElement(() => alertWith("검색하지 못했습니다"));
    await user.type(textbox("질문"), "배포는 언제?");
    await user.click(button("질문"));
    const askAlert = await waitForElement(() => alertWith("질문하지 못했습니다"));

    expect(screen.queryAllByRole("alert")).toHaveLength(2);
    for (const alert of [searchAlert, askAlert]) {
      expect(alert.getAttribute("data-slot")).toBe("alert");
      expect(alert).toHaveClass("text-destructive");
    }
    expect(askAlert).toHaveTextContent("모델 오류");
    expect(within(askAlert).queryByRole("listitem")).toHaveTextContent("sources 형식이 틀렸습니다");
  });

  it("검색 결과가 모두 비면 '없음'이 점선 영역에 보인다", async () => {
    const user = userEvent.setup();
    stubApi({ search: () => json({ notes: [], decisions: [] }) });
    render(<App />);

    await runSearch(user, "없는말");

    expectInDashedArea(await waitForElement(() => screen.queryByText("없음")));
  });

  it("결정 사항만 비면 그 영역의 '없음'이 점선 영역에 보인다", async () => {
    const user = userEvent.setup();
    stubApi({ search: () => json({ notes: searchResult.notes, decisions: [] }) });
    render(<App />);

    await runSearch(user, "검색");

    const decisionsRegion = await waitForElement(() => region("결정 사항 결과"));
    expectInDashedArea(within(decisionsRegion).queryByText("없음") as HTMLElement);
  });

  it("결과 영역은 노트 결과, 결정 사항 결과, 답변 순서로 Card에 담겨 있다", async () => {
    const user = userEvent.setup();
    stubApi();
    render(<App />);

    await runSearch(user, "배포");
    const notesRegion = await waitForElement(() => region("노트 결과"));
    await user.type(textbox("질문"), "배포는 언제?");
    await user.click(button("질문"));
    const answer = await waitForElement(() => region("답변"));
    const decisionsRegion = region("결정 사항 결과") as HTMLElement;

    expect(cardOf(notesRegion)).not.toBeNull();
    expect(cardOf(decisionsRegion)).not.toBeNull();
    expect(cardOf(answer)).not.toBeNull();
    expectBefore(notesRegion, decisionsRegion);
    expectBefore(decisionsRegion, answer);
  });
});
