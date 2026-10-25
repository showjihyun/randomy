import { expect, test } from "@playwright/test";

// 데이터는 POST /api/organized로 직접 만들고 검색은 실제 백엔드를 쓴다.
// 실행 중인 백엔드의 기본 가짜 모델은 빈 객체를 돌려주므로 POST /api/ask만 가로채
// 정해 둔 답변을 준다.
test("키워드로 검색해 노트를 열고, 질문하면 근거 노트가 붙은 답변에서 그 노트를 연다", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const keyword = `J017키워드${stamp}`;
  const title = `J017 e2e 찾기 ${keyword}`;
  const body = `J017 e2e 회의 원문 ${keyword}`;
  const decision = `J017 금요일 배포 ${keyword}`;
  const question = `J017 배포는 언제 하나요 ${stamp}`;
  const answerText = `J017 금요일에 배포합니다 ${stamp}`;

  const saved = await request.post("/api/organized", {
    data: { title, body, summary: "배포 일정을 정했다", decisions: [decision], todos: [] },
  });
  expect(saved.status()).toBe(201);
  const note = ((await saved.json()) as { note: { id: number; title: string; created_at: string } })
    .note;

  const askBodies: unknown[] = [];
  await page.route("**/api/ask", async (route) => {
    askBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answer: answerText,
        sources: [{ id: note.id, title: note.title, created_at: note.created_at }],
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("서버 연결됨 (모델: fake)")).toBeVisible();

  // (1) 검색
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await page.getByRole("textbox", { name: "검색어", exact: true }).fill(keyword);
  await page.getByRole("button", { name: "검색", exact: true }).click();

  const noteResults = page.getByRole("region", { name: "노트 결과", exact: true });
  const decisionResults = page.getByRole("region", { name: "결정 사항 결과", exact: true });
  const noteButton = noteResults.getByRole("button").filter({ hasText: title });
  await expect(noteButton).toBeVisible();
  await expect(decisionResults.getByRole("button").filter({ hasText: decision })).toBeVisible();

  await noteButton.click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText(body, { exact: true })).toBeVisible();

  // (2) 질문
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await page.getByRole("textbox", { name: "질문", exact: true }).fill(question);
  await page.getByRole("button", { name: "질문", exact: true }).click();

  const answer = page.getByRole("region", { name: "답변", exact: true });
  await expect(answer.getByText(answerText, { exact: true })).toBeVisible();
  const sourceButton = answer.getByRole("button", { name: title, exact: true });
  await expect(sourceButton).toBeVisible();
  expect(askBodies).toEqual([{ question }]);

  await sourceButton.click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
});
