import { test, expect } from "@playwright/test";
import { TAURI_MOCK_SCRIPT } from "./helpers/mock-tauri";

test.describe("应用导航", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT);
    await page.goto("/");
  });

  test("应渲染侧边导航栏", async ({ page }) => {
    await expect(page.locator(".app-sidebar")).toBeVisible();
  });

  test("应包含所有导航项", async ({ page }) => {
    const navLabels = [
      "首页", "规划", "对话", "综述", "论文",
      "写作", "知识", "DSH", "投稿", "工具", "设置",
    ];

    for (const label of navLabels) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
  });

  test("默认应显示首页", async ({ page }) => {
    await expect(page.locator(".app-main")).toBeVisible();
  });

  test("点击规划应导航到规划页", async ({ page }) => {
    await page.getByLabel("规划").click();
    await expect(page).toHaveURL("/planner");
  });

  test("点击对话应导航到对话页", async ({ page }) => {
    await page.getByLabel("对话").click();
    await expect(page).toHaveURL("/chat");
  });

  test("点击综述应导航到综述页", async ({ page }) => {
    await page.getByLabel("综述").click();
    await expect(page).toHaveURL("/survey");
  });

  test("点击论文应导航到论文页", async ({ page }) => {
    await page.getByLabel("论文").click();
    await expect(page).toHaveURL("/papers");
  });

  test("点击写作应导航到写作页", async ({ page }) => {
    await page.getByLabel("写作").click();
    await expect(page).toHaveURL("/writing");
  });

  test("点击知识应导航到知识页", async ({ page }) => {
    await page.getByLabel("知识").click();
    await expect(page).toHaveURL("/knowledge");
  });

  test("点击 DSH 应导航到 DSH 页", async ({ page }) => {
    await page.getByLabel("DSH").click();
    await expect(page).toHaveURL("/code");
  });

  test("点击投稿应导航到投稿页", async ({ page }) => {
    await page.getByLabel("投稿").click();
    await expect(page).toHaveURL("/submission");
  });

  test("点击工具应导航到工具页", async ({ page }) => {
    await page.getByLabel("工具").click();
    await expect(page).toHaveURL("/tools");
  });

  test("点击设置应导航到设置页", async ({ page }) => {
    await page.getByLabel("设置").click();
    await expect(page).toHaveURL("/settings");
  });

  test("设置中切换到 Codex 后侧栏显示 Codex", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "界面布局" }).click();
    await page.getByRole("button", { name: /Codex Harness/ }).click();
    await expect(page.getByLabel("Codex")).toBeVisible();
    await expect(page.getByLabel("Codex")).toHaveAttribute("href", "/codex");
    await expect(page.getByLabel("DSH")).toHaveCount(0);
  });

  test("设置中切换到 OpenCode 后侧栏显示 OpenCode", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "界面布局" }).click();
    await page.getByRole("button", { name: /OpenCode/ }).click();
    await expect(page.getByLabel("OpenCode")).toHaveAttribute("href", "/opencode");
    await expect(page.getByLabel("DSH")).toHaveCount(0);
  });

  test("应支持键盘快捷键跳转设置", async ({ page }) => {
    // 等待侧边栏可见，确保键盘快捷键监听已注册。
    await expect(page.locator(".app-sidebar")).toBeVisible();
    await page.keyboard.press("Meta+,");
    await expect(page).toHaveURL("/settings");
  });

  test("/copilot 应重定向到 /chat", async ({ page }) => {
    await page.goto("/copilot");
    await expect(page).toHaveURL("/chat");
  });

  test("/write 应重定向到 /writing", async ({ page }) => {
    await page.goto("/write");
    await expect(page).toHaveURL("/writing");
  });
});
