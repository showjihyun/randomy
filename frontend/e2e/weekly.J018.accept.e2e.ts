import { expect, test } from "@playwright/test";

type Weekly = { start: string; end: string };
type Organized = { todos: { id: number; task: string }[] };

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function periodPattern(start: string, end: string): RegExp {
  return new RegExp(`${start}.*${end}`);
}

// 모델이 필요 없는 흐름이므로 page.route로 가로채지 않고 실제 백엔드를 쓴다.
test("주간 정리에서 이번 주 노트·결정·남은 할 일을 보고 지난주·다음 주로 옮겨 다닌다", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const title = `J018 e2e 주간 노트 ${stamp}`;
  const decision = `J018 주간 결정 ${stamp}`;
  const openTask = `J018 남은 할 일 ${stamp}`;
  const doneTask = `J018 끝낸 할 일 ${stamp}`;

  const created = await request.post("/api/organized", {
    data: {
      title,
      body: `J018 e2e 회의 원문 ${stamp}`,
      summary: `J018 주간 요약 ${stamp}`,
      decisions: [decision],
      todos: [
        { task: openTask, owner: "민수", due: null },
        { task: doneTask, owner: null, due: null },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const done = ((await created.json()) as Organized).todos.find((t) => t.task === doneTask);
  expect(done).toBeDefined();
  const patched = await request.patch(`/api/todos/${done!.id}`, { data: { done: true } });
  expect(patched.status()).toBe(200);

  const current = await request.get("/api/weekly");
  expect(current.status()).toBe(200);
  const { start, end } = (await current.json()) as Weekly;

  await page.goto("/");
  await expect(page.getByText("서버 연결됨 (모델: fake)")).toBeVisible();
  await page.getByRole("button", { name: "주간 정리", exact: true }).click();

  const notes = page.getByRole("region", { name: "이번 주 노트", exact: true });
  const decisions = page.getByRole("region", { name: "결정 사항", exact: true });
  const todos = page.getByRole("region", { name: "남은 할 일", exact: true });

  await expect(page.getByText(periodPattern(start, end))).toBeVisible();
  await expect(notes.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await expect(decisions.getByRole("button", { name: new RegExp(decision) })).toBeVisible();
  await expect(todos.getByRole("listitem").filter({ hasText: openTask })).toBeVisible();
  await expect(todos.getByText(doneTask)).toHaveCount(0);

  await page.getByRole("button", { name: "지난주", exact: true }).click();
  await expect(
    page.getByText(periodPattern(shiftDate(start, -7), shiftDate(end, -7))),
  ).toBeVisible();
  await expect(page.getByText(periodPattern(start, end))).toHaveCount(0);
  await expect(notes.getByText(title)).toHaveCount(0);

  await page.getByRole("button", { name: "다음 주", exact: true }).click();
  await expect(page.getByText(periodPattern(start, end))).toBeVisible();
  await expect(notes.getByRole("button", { name: new RegExp(title) })).toBeVisible();
});
