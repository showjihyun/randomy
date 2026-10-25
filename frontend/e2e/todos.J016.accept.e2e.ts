import { expect, test } from "@playwright/test";

type Todo = { id: number; task: string; done: boolean };

test("할 일 탭에서 할 일을 완료로 표시하고 원본 노트를 연다", async ({ page, request }) => {
  const stamp = Date.now();
  const title = `J016 e2e 노트 ${stamp}`;
  const body = `J016 e2e 원문 ${stamp}: 점검표는 민지가 금요일까지, 배포 공지는 준호가 월요일까지`;
  const firstTask = `J016 점검표 작성 ${stamp}`;
  const secondTask = `J016 배포 공지 ${stamp}`;
  const created = await request.post("/api/organized", {
    data: {
      title,
      body,
      summary: "점검표와 배포 공지를 나눠 맡았다",
      decisions: [],
      todos: [
        { task: firstTask, owner: "민지", due: "2026-10-30" },
        { task: secondTask, owner: "준호", due: "2026-11-02" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const saved = (await created.json()) as { todos: Todo[] };
  const firstId = saved.todos.find((todo) => todo.task === firstTask)?.id;
  expect(firstId).toBeDefined();

  await page.goto("/");
  await expect(page.getByText("서버 연결됨 (모델: fake)")).toBeVisible();
  await page.getByRole("button", { name: "할 일", exact: true }).click();

  const firstItem = page.getByRole("listitem").filter({ hasText: firstTask });
  const secondItem = page.getByRole("listitem").filter({ hasText: secondTask });
  await expect(firstItem).toBeVisible();
  await expect(firstItem.getByText("담당: 민지")).toBeVisible();
  await expect(firstItem.getByText("기한: 2026-10-30")).toBeVisible();
  await expect(secondItem).toBeVisible();
  await expect(secondItem.getByText("담당: 준호")).toBeVisible();
  await expect(secondItem.getByText("기한: 2026-11-02")).toBeVisible();

  const checkbox = firstItem.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(firstItem.locator("s")).toHaveText(firstTask);
  await expect(secondItem.getByRole("checkbox")).not.toBeChecked();

  const listed = await request.get("/api/todos");
  expect(listed.ok()).toBe(true);
  const todos = (await listed.json()) as Todo[];
  expect(todos.find((todo) => todo.id === firstId)?.done).toBe(true);
  expect(todos.find((todo) => todo.task === secondTask)?.done).toBe(false);

  await firstItem.getByRole("button", { name: "원본 노트" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
});
