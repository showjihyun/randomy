import { expect, test, type Locator, type Page } from "@playwright/test";

function monthTitle(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function monthDay(date: Date): string {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

// 같은 실행의 다른 e2e 데이터가 섞일 수 있어 칸 이름의 개수는 숫자이기만 하면 된다.
function dayCell(page: Page, date: Date): Locator {
  return page.getByRole("button", {
    name: new RegExp(`^${monthDay(date)}, 노트 \\d+, 결정 \\d+, 할 일 \\d+$`),
  });
}

function panelTitle(page: Page, date: Date): Locator {
  return page.getByRole("heading", { name: new RegExp(`^${monthDay(date)} \\(.\\)$`) });
}

// 모델이 필요 없는 흐름이므로 page.route로 가로채지 않고 실제 백엔드를 쓴다.
test("캘린더에서 오늘의 노트·결정과 내일 기한인 할 일을 보고 노트 상세를 연다", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const title = `J035 e2e 캘린더 노트 ${stamp}`;
  const decision = `J035 캘린더 결정 ${stamp}`;
  const task = `J035 내일 할 일 ${stamp}`;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const created = await request.post("/api/organized", {
    data: {
      title,
      body: `J035 e2e 회의 원문 ${stamp}`,
      summary: `J035 캘린더 요약 ${stamp}`,
      decisions: [decision],
      todos: [{ task, owner: null, due: "내일" }],
    },
  });
  expect(created.status()).toBe(201);

  await page.goto("/");
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  await expect(page.getByRole("heading", { name: monthTitle(today), exact: true })).toBeVisible();

  const notes = page.getByRole("region", { name: "노트", exact: true });
  const decisions = page.getByRole("region", { name: "결정 사항", exact: true });
  const todos = page.getByRole("region", { name: "기한인 할 일", exact: true });

  await dayCell(page, today).click();
  await expect(panelTitle(page, today)).toBeVisible();
  await expect(notes.getByRole("button", { name: title, exact: true })).toBeVisible();
  await expect(decisions.getByRole("button", { name: decision, exact: true })).toBeVisible();
  await expect(todos.getByText(task)).toHaveCount(0);

  if (tomorrow.getMonth() !== today.getMonth()) {
    await page.getByRole("button", { name: "다음 달", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: monthTitle(tomorrow), exact: true }),
    ).toBeVisible();
  }
  await dayCell(page, tomorrow).click();
  await expect(panelTitle(page, tomorrow)).toBeVisible();
  await expect(todos.getByRole("button", { name: task, exact: true })).toBeVisible();
  await expect(notes.getByText(title)).toHaveCount(0);

  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(panelTitle(page, today)).toBeVisible();
  await notes.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true, level: 2 })).toBeVisible();
});
