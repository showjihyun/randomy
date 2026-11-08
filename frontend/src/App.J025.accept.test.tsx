import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const TABS: [string, string][] = [
  ["노트", "lucide-notebook-pen"],
  ["할 일", "lucide-list-todo"],
  ["찾기", "lucide-search"],
  ["주간 정리", "lucide-calendar-range"],
];

const DESCRIPTION = "회의록·메모를 정리하고 할 일과 결정 사항을 찾아 주는 개인 업무 보조";
const DASHED = ["border", "border-dashed", "rounded-lg", "p-8", "text-center"];
const MUTED_SMALL = ["text-xs", "text-muted-foreground"];
const STATUS_TEXT = "서버 연결됨 (모델: fake)";

const note = {
  id: 2,
  title: "주간 회의",
  body: "결정: 다음 주 배포",
  created_at: "2026-10-23T09:30:00+00:00",
};

const openTodo = {
  id: 3,
  note_id: 2,
  task: "릴리스 노트 작성",
  owner: "민수",
  due: "2026-10-30",
  done: false,
  created_at: "2026-10-23T10:00:00+00:00",
};

const bareTodo = {
  id: 2,
  note_id: 2,
  task: "검색 화면 시안 만들기",
  owner: null,
  due: null,
  done: false,
  created_at: "2026-10-22T09:00:00+00:00",
};

const doneTodo = {
  id: 1,
  note_id: 2,
  task: "배포 일정 공유",
  owner: "지은",
  due: null,
  done: true,
  created_at: "2026-10-23T09:40:00+00:00",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Options = {
  notes?: (typeof note)[];
  todos?: unknown[];
  detailMissing?: boolean;
  saveFails?: boolean;
};

// 가짜 서버: 화면을 그리는 데 필요한 응답만 돌려준다.
function stubApi({ notes = [note], todos = [], detailMissing = false, saveFails = false }: Options) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/health") {
      return json({ status: "ok", model: "fake" });
    }
    if (path === "/api/notes" && method === "POST") {
      return saveFails ? json({ detail: "boom" }, 500) : json(note, 201);
    }
    if (path === "/api/notes") {
      return json(notes);
    }
    if (/^\/api\/notes\/\d+$/.test(path)) {
      return detailMissing ? json({ detail: "Not Found" }, 404) : json(note);
    }
    if (path === "/api/todos") {
      return json(todos);
    }
    if (path === "/api/weekly") {
      return json({
        start: "2026-10-19",
        end: "2026-10-25",
        notes: [],
        decisions: [],
        open_todos: [],
      });
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

function button(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name });
}

function heading(name: string, level: number): HTMLElement | null {
  return screen.queryByRole("heading", { name, level });
}

function textbox(name: string): HTMLElement | null {
  return screen.queryByRole("textbox", { name });
}

function shell(): Element | null {
  return document.querySelector("aside");
}

function content(): Element | null {
  return document.querySelector("main .max-w-4xl");
}

function cardOf(element: Element | null | undefined): Element | null {
  return element?.closest('[data-slot="card"]') ?? null;
}

// jest-dom 매처의 실패는 assertion 실패로 집계되지 않으므로 값을 꺼내 expect로 비교한다.
function classesOf(element: Element | null | undefined): string[] {
  return Array.from(element?.classList ?? []);
}

function expectClasses(element: Element | null | undefined, classes: string[]) {
  expect(classesOf(element)).toEqual(expect.arrayContaining(classes));
}

function expectSlotButton(element: HTMLElement | null, variant: string) {
  expect(element?.getAttribute("data-slot")).toBe("button");
  expect(element?.getAttribute("data-variant")).toBe(variant);
}

function expectOnlySelected(selected: string) {
  for (const [name] of TABS) {
    const tab = button(name);
    if (name === selected) {
      expect(tab?.getAttribute("aria-current")).toBe("page");
      expectClasses(tab, ["bg-accent", "font-medium"]);
    } else {
      expect(tab?.getAttribute("aria-current") ?? null).toBeNull();
      expect(classesOf(tab)).not.toContain("bg-accent");
    }
  }
}

function expectPageTitle(element: HTMLElement | null) {
  expect(element?.tagName).toBe("H2");
  expectClasses(element, ["text-2xl", "font-semibold"]);
}

function expectEmptyState(text: string) {
  expectClasses(screen.queryByText(text)?.closest(".border-dashed"), DASHED);
}

function isBefore(first: Element | null | undefined, second: Element | null | undefined): boolean {
  if (!first || !second) {
    return false;
  }
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

async function renderApp(options: Options = {}) {
  const user = userEvent.setup();
  stubApi(options);
  render(<App />);
  await waitForElement(() => screen.queryByText(STATUS_TEXT));
  return user;
}

async function renderList() {
  const user = await renderApp();
  const row = await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ }));
  return { user, row };
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await waitForElement(() => button("새 노트")));
  await waitForElement(() => textbox("본문"));
}

async function renderTodos(todos: Options["todos"]) {
  const user = await renderApp({ todos });
  await user.click(button("할 일") as HTMLElement);
  return user;
}

describe("J025 앱 껍데기 디자인", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("탭 4개는 역할이 button인 ghost Button이고 아이콘과 글자를 함께 갖는다", async () => {
    await renderList();

    for (const [name, icon] of TABS) {
      const tab = button(name);
      expectSlotButton(tab, "ghost");
      expect(tab?.tagName).toBe("BUTTON");
      expect(tab?.querySelector(`svg.${icon}`)).not.toBeNull();
      expect(tab?.textContent).toBe(name);
    }
  });

  it("선택된 탭에만 aria-current와 강조가 있고 누르면 그 화면으로 옮겨 간다", async () => {
    const user = await renderApp({ todos: [openTodo] });
    await waitForElement(() => button("새 노트"));
    expectOnlySelected("노트");

    await user.click(button("할 일") as HTMLElement);
    await waitForElement(() => screen.queryByText(openTodo.task));
    expectOnlySelected("할 일");
    expect(button("새 노트")).toBeNull();

    await user.click(button("찾기") as HTMLElement);
    await waitForElement(() => button("검색"));
    expectOnlySelected("찾기");

    await user.click(button("주간 정리") as HTMLElement);
    await waitForElement(() => screen.queryByRole("region", { name: "이번 주 노트" }));
    expectOnlySelected("주간 정리");

    await user.click(button("노트") as HTMLElement);
    await waitForElement(() => button("새 노트"));
    expectOnlySelected("노트");
  });

  it("'원본 노트'로 노트를 열면 노트 탭이 선택된다", async () => {
    const user = await renderTodos([openTodo]);
    await user.click(await waitForElement(() => button("원본 노트")));
    await waitForElement(() => heading(note.title, 2));

    expectOnlySelected("노트");
  });

  it("껍데기는 min-h-screen lg:flex 안의 aside와 main이고 본문 폭이 정해져 있다", async () => {
    await renderList();

    const aside = shell();
    expectClasses(aside, ["lg:w-56", "lg:border-r", "bg-sidebar"]);
    expectClasses(aside?.parentElement, ["min-h-screen", "lg:flex"]);

    const main = document.querySelector("main");
    expect(main?.parentElement).toBe(aside?.parentElement);
    expectClasses(main, ["flex-1"]);
    expectClasses(content(), ["mx-auto", "max-w-4xl", "px-4", "py-6", "lg:px-8", "lg:py-8"]);
  });

  it("h1은 하나이고 aside 안에 설명·탭과 함께 있으며 탭 줄은 반응형이다", async () => {
    await renderList();

    const aside = shell();
    const titles = screen.queryAllByRole("heading", { level: 1 });
    expect(titles).toHaveLength(1);
    expect(titles[0].textContent).toBe("Randomy");
    expect(aside?.contains(titles[0])).toBe(true);
    expectClasses(titles[0], ["text-lg", "font-semibold"]);

    const description = screen.queryByText(DESCRIPTION);
    expect(aside?.contains(description)).toBe(true);
    expectClasses(description, MUTED_SMALL);

    const row = button("노트")?.parentElement;
    for (const [name] of TABS) {
      expect(button(name)?.parentElement).toBe(row);
    }
    expect(aside?.contains(row as Element)).toBe(true);
    expectClasses(row, ["flex", "lg:flex-col"]);
    expect(row?.closest(".px-4")).not.toBeNull();
  });

  it("상태 문구는 본문 영역에서 목록보다 위에 있다", async () => {
    const { row } = await renderList();
    const status = screen.queryByRole("status");

    expect(content()?.contains(status)).toBe(true);
    expectClasses(status, ["text-sm", "text-muted-foreground"]);
    expect(isBefore(status, row)).toBe(true);
  });

  it("정리·찾기·주간 정리 화면은 본문 영역 안에 그려진다", async () => {
    const { user } = await renderList();

    await user.click(button("정리") as HTMLElement);
    const raw = await waitForElement(() => textbox("원문"));
    expect(content()?.contains(raw)).toBe(true);

    await user.click(button("찾기") as HTMLElement);
    const search = await waitForElement(() => button("검색"));
    expect(content()?.contains(search)).toBe(true);

    await user.click(button("주간 정리") as HTMLElement);
    const weekly = await waitForElement(() =>
      screen.queryByRole("region", { name: "이번 주 노트" }),
    );
    expect(content()?.contains(weekly)).toBe(true);
  });
});

describe("J025 노트 화면 디자인", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("목록 제목 줄에 h2 '노트'와 '새 노트'(outline)·'정리'(default)가 있다", async () => {
    await renderList();

    const title = heading("노트", 2);
    expectPageTitle(title);
    expectSlotButton(button("새 노트"), "outline");
    expectSlotButton(button("정리"), "default");

    const line = title?.parentElement;
    expectClasses(line, ["flex", "justify-between"]);
    expect(line?.contains(button("새 노트"))).toBe(true);
    expect(line?.contains(button("정리"))).toBe(true);
  });

  it("노트 행은 Card 안의 hover:bg-accent 버튼이고 제목과 오른쪽 날짜를 보여 준다", async () => {
    const { row } = await renderList();

    expect(cardOf(row)).not.toBeNull();
    expect(row.closest("li")).not.toBeNull();
    expect(classesOf(row)).toContain("hover:bg-accent");
    expectClasses(within(row).queryByText(note.title), ["font-medium"]);

    const date = within(row).queryByText(note.created_at);
    expect(date?.tagName).toBe("TIME");
    expectClasses(date, MUTED_SMALL);
    expect(
      classesOf(row).includes("justify-between") || classesOf(date).includes("ml-auto"),
    ).toBe(true);
  });

  it("노트가 없으면 기존 문구가 점선 영역 안에 있고 제목 줄은 그대로다", async () => {
    await renderApp({ notes: [] });
    await waitForElement(() => screen.queryByText("저장된 노트가 없습니다"));

    expectEmptyState("저장된 노트가 없습니다");
    expectPageTitle(heading("노트", 2));
  });

  it("작성 화면은 Card 안의 Label·Input·Textarea다", async () => {
    const { user } = await renderList();
    await openForm(user);

    const title = textbox("제목") as HTMLInputElement | null;
    const body = textbox("본문") as HTMLTextAreaElement | null;
    expect(title?.getAttribute("data-slot")).toBe("input");
    expect(body?.getAttribute("data-slot")).toBe("textarea");
    expect(title?.labels?.[0]?.getAttribute("data-slot")).toBe("label");
    expect(body?.labels?.[0]?.getAttribute("data-slot")).toBe("label");
    expect(classesOf(body)).toContain("min-h-48");
    expect(cardOf(title)).not.toBeNull();
    expect(cardOf(body)).toBe(cardOf(title));
  });

  it("작성 화면 아래 오른쪽에 '취소'(outline)·'저장'(default)이 이 순서로 있다", async () => {
    const { user } = await renderList();
    await openForm(user);

    const cancel = button("취소");
    const save = button("저장");
    expectSlotButton(cancel, "outline");
    expectSlotButton(save, "default");
    expect(cancel?.getAttribute("type")).toBe("button");
    expect(save?.getAttribute("type")).toBe("submit");
    expect(cancel?.parentElement).toBe(save?.parentElement);
    expect(classesOf(save?.parentElement)).toContain("justify-end");
    expect(isBefore(cancel, save)).toBe(true);
  });

  it("저장에 실패하면 기존 문구가 destructive Alert 안에 보인다", async () => {
    const user = await renderApp({ saveFails: true });
    await openForm(user);
    expect(screen.queryByRole("alert")).toBeNull();

    await user.type(textbox("본문") as HTMLElement, "본문 내용");
    await user.click(button("저장") as HTMLElement);
    await waitForElement(() => screen.queryByText("저장하지 못했습니다"));

    const alert = screen.queryByRole("alert");
    expect(alert?.getAttribute("data-slot")).toBe("alert");
    expect(classesOf(alert)).toContain("text-destructive");
    expect(alert?.textContent).toContain("저장하지 못했습니다");
  });

  it("상세 화면은 h2 제목·날짜, 본문 Card, '목록으로'(outline)다", async () => {
    const { user, row } = await renderList();
    await user.click(row);
    await waitForElement(() => heading(note.title, 2));

    expectPageTitle(heading(note.title, 2));
    const date = screen.queryByText(note.created_at);
    expect(date?.tagName).toBe("TIME");
    expectClasses(date, MUTED_SMALL);

    const body = screen.queryByText(note.body);
    expect(cardOf(body)).not.toBeNull();
    expect(body?.closest(".whitespace-pre-wrap")).not.toBeNull();
    expect(body?.closest(".leading-7")).not.toBeNull();
    expectSlotButton(button("목록으로"), "outline");
  });

  it("찾지 못함 문구도 Card 안에 있고 '목록으로'는 outline이다", async () => {
    const user = await renderApp({ detailMissing: true });
    await user.click(await waitForElement(() => screen.queryByRole("button", { name: /주간 회의/ })));
    await waitForElement(() => screen.queryByText("노트를 찾을 수 없습니다"));

    expect(cardOf(screen.queryByText("노트를 찾을 수 없습니다"))).not.toBeNull();
    expectSlotButton(button("목록으로"), "outline");
  });
});

describe("J025 할 일 화면 디자인", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("h2 '할 일'과 Card 안 목록을 보여 준다", async () => {
    await renderTodos([openTodo, bareTodo]);
    await waitForElement(() => screen.queryByText(openTodo.task));

    expectPageTitle(heading("할 일", 2));
    const items = screen.queryAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(cardOf(item)).not.toBeNull();
    }
  });

  it("담당·기한은 secondary Badge이고 값이 없으면 Badge가 없다", async () => {
    await renderTodos([openTodo, bareTodo]);
    await waitForElement(() => screen.queryByText(openTodo.task));

    const items = screen.queryAllByRole("listitem");
    for (const text of ["담당: 민수", "기한: 2026-10-30"]) {
      const badge = within(items[0]).queryByText(text);
      expect(badge?.getAttribute("data-slot")).toBe("badge");
      expect(badge?.getAttribute("data-variant")).toBe("secondary");
    }
    expect(items[1].querySelectorAll('[data-slot="badge"]')).toHaveLength(0);
  });

  it("'원본 노트'는 ghost·sm Button이다", async () => {
    await renderTodos([openTodo]);
    const origin = await waitForElement(() => button("원본 노트"));

    expectSlotButton(origin, "ghost");
    expect(origin.getAttribute("data-size")).toBe("sm");
  });

  it("완료한 할 일만 s 요소에 line-through text-muted-foreground가 있다", async () => {
    await renderTodos([openTodo, doneTodo]);
    await waitForElement(() => screen.queryByText(doneTodo.task));

    const done = screen.queryByText(doneTodo.task);
    expect(done?.tagName).toBe("S");
    expectClasses(done, ["line-through", "text-muted-foreground"]);
    expect(classesOf(screen.queryByText(openTodo.task))).not.toContain("line-through");
  });

  it("할 일이 없으면 기존 문구가 점선 영역 안에 있다", async () => {
    await renderTodos([]);
    await waitForElement(() => screen.queryByText("할 일이 없습니다"));

    expectEmptyState("할 일이 없습니다");
  });
});
