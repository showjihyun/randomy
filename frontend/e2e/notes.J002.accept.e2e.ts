import { expect, test } from "@playwright/test";

test("저장한 노트를 목록에서 골라 상세를 보고 목록으로 돌아간다", async ({ page, request }) => {
  const title = `J002 e2e 노트 ${Date.now()}`;
  const body = "결정: 금요일 배포. 할 일: 점검표 작성";
  const created = await request.post("/api/notes", { data: { title, body } });
  expect(created.status()).toBe(201);

  await page.goto("/");
  await expect(page.getByText("서버 연결됨 (모델: fake)")).toBeVisible();

  const item = page.getByRole("button", { name: new RegExp(title) });
  await expect(item).toBeVisible();
  await item.click();

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();

  await page.getByRole("button", { name: "목록으로" }).click();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByText(body)).toHaveCount(0);
});
