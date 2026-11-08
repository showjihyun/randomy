import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Organize from "./Organize";

const RAW = "주간 회의 메모";

const result = {
  summary: "배포 일정을 정했다",
  decisions: ["금요일에 배포한다"],
  todos: [{ task: "릴리스 노트 작성", owner: "민수", due: "2026-10-30" }],
};

const savedNote = { id: 2, title: "새", body: RAW, created_at: "2026-10-25T10:00:00+00:00" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Options = {
  organize?: () => Response | Promise<Response>;
  save?: () => Response | Promise<Response>;
};

function stubApi(options: Options = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/organize" && method === "POST") {
      return options.organize ? options.organize() : json(result);
    }
    if (path === "/api/organized" && method === "POST") {
      return options.save
        ? options.save()
        : json({ note: savedNote, summary: "", decisions: [], todos: [] }, 201);
    }
    return json({ detail: "Not Found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
}

// 응답을 테스트가 직접 풀어줄 때까지 붙잡아 둔다.
function deferred() {
  let respond: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  return { pending, respond: (response: Response) => respond(response) };
}

// getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, 값을 expect로 먼저 확인한다.
function must<T>(value: T | null | undefined): T {
  expect(value ?? null).not.toBeNull();
  return value as T;
}

function textbox(name: string): HTMLElement {
  return must(screen.queryByRole("textbox", { name }));
}

function button(name: string): HTMLButtonElement {
  return must(screen.queryByRole("button", { name })) as HTMLButtonElement;
}

function classes(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/);
}

function spinner(element: HTMLElement): Element | null {
  return element.querySelector("svg.animate-spin");
}

function expectVariant(element: HTMLElement, variant: string, size: string) {
  expect(element.getAttribute("data-slot")).toBe("button");
  expect(element.getAttribute("data-variant")).toBe(variant);
  expect(element.getAttribute("data-size")).toBe(size);
}

function expectSpinnerFirst(element: HTMLElement, label: string) {
  const icon = must(spinner(element));
  expect(element.firstChild).toBe(icon);
  expect(element.textContent).toBe(label);
}

function expectDocumentOrder(elements: Element[]) {
  for (let i = 0; i + 1 < elements.length; i += 1) {
    const following = elements[i].compareDocumentPosition(elements[i + 1]);
    expect(following & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  }
}

function resultCard(): HTMLElement {
  return must(textbox("제목").closest<HTMLElement>('[data-slot="card"]'));
}

function heading3(name: string): HTMLElement {
  return must(screen.queryByRole("heading", { name, level: 3 }));
}

function nearestSizedGrid(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current !== null) {
    if (classes(current).includes("sm:grid-cols-[2fr_1fr_1fr]")) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

async function typeRaw(user: ReturnType<typeof userEvent.setup>) {
  render(<Organize onSaved={vi.fn()} />);
  await user.type(textbox("원문"), RAW);
}

async function organizeRaw(user: ReturnType<typeof userEvent.setup>) {
  await typeRaw(user);
  await user.click(button("정리"));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "요약" })).not.toBeNull());
}

describe("J022 정리 화면 디자인", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("원문 입력은 min-h-56 Textarea이고 '정리'는 기본 Button이다", () => {
    stubApi();
    render(<Organize onSaved={vi.fn()} />);

    const raw = textbox("원문");
    expect(raw.getAttribute("data-slot")).toBe("textarea");
    expect(classes(raw)).toContain("min-h-56");
    expectVariant(button("정리"), "default", "default");
    expect(spinner(button("정리"))).toBeNull();
  });

  it("정리 요청 중에는 '정리' 버튼이 막히고 글자 앞에 도는 아이콘이 있으며 응답이 오면 사라진다", async () => {
    const user = userEvent.setup();
    const organize = deferred();
    stubApi({ organize: () => organize.pending });

    await typeRaw(user);
    await user.click(button("정리"));

    await waitFor(() => expect(button("정리").disabled).toBe(true));
    expectSpinnerFirst(button("정리"), "정리");

    organize.respond(json(result));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "요약" })).not.toBeNull());
    expect(button("정리").disabled).toBe(false);
    expect(spinner(button("정리"))).toBeNull();
  });

  it("정리 오류는 destructive Alert에 기존 문구 그대로 보인다", async () => {
    const user = userEvent.setup();
    stubApi({
      organize: () =>
        json({ detail: { message: "모델 출력이 형식에 맞지 않습니다", problems: ["summary 필드가 없습니다"] } }, 502),
    });

    await typeRaw(user);
    await user.click(button("정리"));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    const alert = must(screen.queryByRole("alert"));
    expect(alert.getAttribute("data-slot")).toBe("alert");
    expect(classes(alert)).toContain("text-destructive");
    expect(alert.textContent).toContain("정리하지 못했습니다");
    expect(alert.textContent).toContain("모델 출력이 형식에 맞지 않습니다");
    expect(alert.textContent).toContain("summary 필드가 없습니다");
  });

  it("정리 결과 편집은 Card 하나 안에 있고 입력칸은 Input·Textarea다", async () => {
    const user = userEvent.setup();
    stubApi();

    await organizeRaw(user);

    const card = resultCard();
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    for (const name of ["제목", "결정 1", "할 일 1", "담당 1", "기한 1"]) {
      const input = textbox(name);
      expect(input.getAttribute("data-slot")).toBe("input");
      expect(card.contains(input)).toBe(true);
    }
    const summary = textbox("요약");
    expect(summary.getAttribute("data-slot")).toBe("textarea");
    expect(card.contains(summary)).toBe(true);
    expect(card.contains(button("저장"))).toBe(true);
  });

  it("카드 안 순서는 제목·요약, 구분선, 결정 사항, 구분선, 할 일, 저장이고 소제목은 h3다", async () => {
    const user = userEvent.setup();
    stubApi();

    await organizeRaw(user);

    const card = resultCard();
    const separators = Array.from(card.querySelectorAll('[data-slot="separator"]'));
    expect(separators).toHaveLength(2);
    const decisions = heading3("결정 사항");
    const todos = heading3("할 일");
    expect(classes(decisions)).toEqual(expect.arrayContaining(["text-base", "font-semibold"]));
    expect(classes(todos)).toEqual(expect.arrayContaining(["text-base", "font-semibold"]));
    expectDocumentOrder([
      textbox("제목"),
      textbox("요약"),
      separators[0],
      decisions,
      textbox("결정 1"),
      button("결정 추가"),
      separators[1],
      todos,
      textbox("할 일 1"),
      button("할 일 추가"),
      button("저장"),
    ]);
  });

  it("빼기는 ghost sm, 추가는 outline sm, 저장은 기본 Button이고 오른쪽에 붙는다", async () => {
    const user = userEvent.setup();
    stubApi();

    await organizeRaw(user);

    expectVariant(button("결정 1 삭제"), "ghost", "sm");
    expectVariant(button("할 일 1 삭제"), "ghost", "sm");
    expectVariant(button("결정 추가"), "outline", "sm");
    expectVariant(button("할 일 추가"), "outline", "sm");
    expectVariant(button("저장"), "default", "default");
    expect(classes(must(button("저장").parentElement))).toContain("justify-end");
  });

  it("할 일·담당·기한은 sm 이상에서만 2fr 1fr 1fr 가로 grid다", async () => {
    const user = userEvent.setup();
    stubApi();

    await organizeRaw(user);

    const grid = must(nearestSizedGrid(textbox("할 일 1")));
    expect(nearestSizedGrid(textbox("담당 1"))).toBe(grid);
    expect(nearestSizedGrid(textbox("기한 1"))).toBe(grid);
    expect(classes(grid)).toContain("grid");
    expect(classes(grid)).not.toContain("grid-cols-[2fr_1fr_1fr]");
    expect(grid.contains(button("할 일 1 삭제"))).toBe(false);
  });

  it("저장 요청 중에는 '저장' 버튼이 막히고 도는 아이콘이 있으며 실패하면 다시 누를 수 있다", async () => {
    const user = userEvent.setup();
    const save = deferred();
    stubApi({ save: () => save.pending });

    await organizeRaw(user);
    expect(spinner(button("저장"))).toBeNull();
    await user.click(button("저장"));

    await waitFor(() => expect(button("저장").disabled).toBe(true));
    expectSpinnerFirst(button("저장"), "저장");

    save.respond(json({ detail: { message: "저장 검사 실패", problems: [] } }, 422));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(button("저장").disabled).toBe(false);
    expect(spinner(button("저장"))).toBeNull();
  });
});
