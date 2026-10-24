import { expect, test } from "@playwright/test";

test("첫 화면이 서버와 연결된다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Randomy" })).toBeVisible();
  await expect(page.getByText("서버 연결됨 (모델: fake)")).toBeVisible();
});
