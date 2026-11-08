import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Search from "./Search";

const CARD = '[data-slot="card"]';
const CREATED_AT = "2026-10-20T09:00:00+00:00";

const note = { id: 2, title: "아이디어 메모", snippet: "검색 화면 개선", created_at: CREATED_AT };
const decision = {
  id: 7,
  note_id: 1,
  note_title: "주간 회의",
  text: "금요일에 배포한다",
  created_at: CREATED_AT,
};
const fullResult = { notes: [note], decisions: [decision] };
const askResult = {
  answer: "금요일에 배포하기로 했습니다",
  sources: [{ id: 1, title: "주간 회의", created_at: CREATED_AT }],
};

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi(searchResult: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      return json(path === "/api/ask" ? askResult : searchResult);
    }),
  );
}

// findBy*·getBy*는 못 찾으면 assertion이 아닌 오류를 던지므로, query*를 expect로 기다린다.
async function waitForRegion(name: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.queryByRole("region", { name })).not.toBeNull());
  return screen.queryByRole("region", { name }) as HTMLElement;
}

async function submit(label: string, value: string, action: string) {
  const user = userEvent.setup();
  render(<Search onOpenNote={vi.fn()} />);
  await user.type(screen.queryByRole("textbox", { name: label }) as HTMLElement, value);
  await user.click(screen.queryByRole("button", { name: action }) as HTMLElement);
}

function classesOf(element: Element | null): string[] {
  expect(element).not.toBeNull();
  return Array.from((element as Element).classList);
}

function expectListSpacing(area: HTMLElement) {
  const card = classesOf(area.querySelector(CARD));
  expect(card).toEqual(expect.arrayContaining(["py-0", "gap-0"]));
  expect(card).not.toContain("px-2");
  expect(classesOf(area.querySelector("ul"))).toContain("divide-y");
  const rows = within(area).queryAllByRole("button");
  expect(rows).toHaveLength(1);
  expect(classesOf(rows[0])).toEqual(expect.arrayContaining(["px-4", "py-3"]));
}

function expectCardUntouched(element: Element | null, horizontal: string) {
  const card = classesOf(element);
  expect(card).toContain(horizontal);
  expect(card).not.toContain("py-0");
  expect(card).not.toContain("gap-0");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("J027 찾기 결과 목록 카드 여백", () => {
  it.each(["노트 결과", "결정 사항 결과"])("%s 목록은 행이 여백을 갖고 행 사이에 구분선이 있다", async (name) => {
    stubApi(fullResult);
    await submit("검색어", "배포", "검색");
    expectListSpacing(await waitForRegion(name));
  });

  it("답변 Card와 폼 Card는 목록 여백을 받지 않는다", async () => {
    stubApi(fullResult);
    await submit("검색어", "배포", "검색");
    expectListSpacing(await waitForRegion("노트 결과"));

    const user = userEvent.setup();
    await user.type(screen.queryByRole("textbox", { name: "질문" }) as HTMLElement, "언제 배포해?");
    await user.click(screen.queryByRole("button", { name: "질문" }) as HTMLElement);
    const answer = await waitForRegion("답변");

    expectCardUntouched(answer.querySelector(CARD), "px-6");
    expectCardUntouched(screen.queryByRole("textbox", { name: "검색어" })?.closest(CARD) ?? null, "px-6");
  });

  it("결과가 0건인 쪽의 Card는 그대로 두고 행이 있는 쪽만 바뀐다", async () => {
    stubApi({ notes: [], decisions: [decision] });
    await submit("검색어", "배포", "검색");

    expectListSpacing(await waitForRegion("결정 사항 결과"));
    expectCardUntouched((await waitForRegion("노트 결과")).querySelector(CARD), "px-2");
  });
});
