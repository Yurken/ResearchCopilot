import { test, expect } from "@playwright/test";
import { TAURI_MOCK_SCRIPT, tauriMockScriptWith } from "./helpers/mock-tauri";

test.describe("工具页面标签切换", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.goto("/tools");
  });

  test("应支持所有标签切换", async ({ page }) => {
    const tabs = ["论文检索", "刊会查询", "学术翻译", "MD 整理", "生成 PPT", "科研友链"];

    for (const tab of tabs) {
      const tabButton = page.getByRole("button", { name: tab });
      await tabButton.click();
      await expect(tabButton).toBeVisible();
    }
  });

  test("切换标签应更新激活状态", async ({ page }) => {
    await page.getByRole("button", { name: "刊会查询" }).click();
    await expect(page.getByText("刊会查询")).toHaveCount(2);

    await page.getByRole("button", { name: "学术翻译" }).click();
    await expect(page.getByText("学术翻译")).toHaveCount(2);
  });
});

test.describe("对话页面交互", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      tauriMockScriptWith({
        chat_list_sessions: [
          {
            id: "session-1",
            title: "测试会话",
            mode: "direct",
            interestId: null,
            pinned: false,
            createdAt: "2024-01-10T10:00:00Z",
            updatedAt: "2024-01-10T10:00:00Z",
          },
        ],
      }),
    );
    await page.goto("/chat");
  });

  test("应显示对话界面元素", async ({ page }) => {
    await expect(page.locator(".app-main")).toBeVisible();
  });
});
