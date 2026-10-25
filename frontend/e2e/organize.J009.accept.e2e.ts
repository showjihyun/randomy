import { expect, test } from "@playwright/test";

// 실행 중인 백엔드의 기본 가짜 모델은 빈 객체를 돌려주므로 POST /api/organize만 가로채
// 정해 둔 정리 결과를 준다. 저장 이후는 실제 백엔드를 쓴다.
test("원문을 정리해 고친 뒤 저장하면 노트 상세가 열리고 노트 목록·할 일 탭에 새 항목이 보인다", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const title = `J009 e2e 정리 ${stamp}`;
  const raw = `J009 e2e 회의 원문 ${stamp}`;
  const task = `J009 릴리스 노트 작성 ${stamp}`;
  const decision = `J009 금요일 배포 ${stamp}`;
  const organizeBodies: unknown[] = [];

  await page.route("**/api/organize", async (route) => {
    organizeBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "배포 일정을 정했다",
        decisions: [decision, "지울 결정"],
        todos: [{ task, owner: "민수", due: "2026-10-30" }],
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("서버 연결됨 (모델: fake)")).toBeVisible();

  const entry = page.getByRole("button", { name: "정리", exact: true });
  await expect(entry).toBeVisible();
  await entry.click();

  const rawBox = page.getByRole("textbox", { name: "원문", exact: true });
  await expect(rawBox).toBeVisible();
  await rawBox.fill(raw);
  await page.getByRole("button", { name: "정리", exact: true }).click();

  await expect(page.getByRole("textbox", { name: "요약", exact: true })).toHaveValue(
    "배포 일정을 정했다",
  );
  expect(organizeBodies).toEqual([{ text: raw }]);

  await page.getByRole("textbox", { name: "제목", exact: true }).fill(title);
  await page.getByRole("button", { name: "결정 2 삭제", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "결정 2", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "담당 1", exact: true }).fill("지현");
  await page.getByRole("button", { name: "저장", exact: true }).click();

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(raw)).toBeVisible();

  const decisions = await request.get("/api/decisions");
  expect(decisions.status()).toBe(200);
  const texts = ((await decisions.json()) as { text: string }[]).map((d) => d.text);
  expect(texts).toContain(decision);
  expect(texts).not.toContain("지울 결정");

  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();

  await page.getByRole("button", { name: "할 일", exact: true }).click();
  const todo = page.getByRole("listitem").filter({ hasText: task });
  await expect(todo).toBeVisible();
  await expect(todo).toContainText("담당: 지현");
  await expect(todo).toContainText("기한: 2026-10-30");
});
