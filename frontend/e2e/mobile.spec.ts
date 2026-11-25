/**
 * Phones first: colleagues test on their phones before the desktop.
 * Checks layout (no sideways scrolling), the bottom tabs, one-thing-at-a-time
 * history, and form fields that do not make iPhones zoom in.
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn, signOut } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function expectNoSidewaysScroll(page: Page, where: string) {
  const widths = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, screen: window.innerWidth }));
  expect(widths.content, `${where} is wider than the phone`).toBeLessThanOrEqual(widths.screen + 1);
}

const PAGES: Array<{ user: string; paths: string[]; tabs: string[] }> = [
  { user: "operations", paths: ["/dashboard", "/report", "/faults?mode=history"], tabs: ["Report", "My reports", "History", "More"] },
  { user: "st-electrical", paths: ["/dashboard", "/faults?mode=history", "/watch", "/recognition", "/account"], tabs: ["My jobs", "History", "Watch", "More"] },
  { user: "ct-electrical", paths: ["/dashboard", "/drawings", "/expertise", "/approvals"], tabs: ["Section", "History", "Reviews", "More"] },
  { user: "maintenance-manager", paths: ["/dashboard", "/analytics", "/reports", "/watch"], tabs: ["Overview", "Analytics", "Reports", "More"] },
  { user: "hr", paths: ["/dashboard", "/recognition", "/expertise", "/people"], tabs: ["Workforce", "Points", "People", "More"] },
  { user: "ceo", paths: ["/dashboard", "/analytics", "/reports"], tabs: ["Summary", "Analytics", "Reports", "More"] },
];

for (const { user, paths, tabs } of PAGES) {
  test(`${user}: every main page fits the phone, with bottom tabs`, async ({ page }) => {
    await signIn(page, user);
    const quick = page.getByRole("navigation", { name: "Quick" });
    for (const label of tabs.slice(0, -1)) await expect(quick.getByRole("link", { name: label, exact: true })).toBeVisible();
    await expect(quick.getByRole("button", { name: "More" })).toBeVisible();
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoSidewaysScroll(page, `${user} ${path}`);
    }
  });
}

test("More opens the full menu with the account and sign-out", async ({ page }) => {
  await signIn(page, "st-electrical");
  await page.getByRole("navigation", { name: "Quick" }).getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("navigation", { name: "Main" });
  await expect(menu.getByRole("link", { name: "Procedures" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await menu.getByRole("link", { name: "Expert knowledge" }).click();
  await expect(page.getByRole("heading", { name: "Expert knowledge" })).toBeVisible();
  await expect(menu).toBeHidden(); // the menu closes after choosing
  await signOut(page);
  await expect(page.getByLabel("KPC email")).toBeVisible();
});

test("history shows one thing at a time: tap a breakdown, then back to the list", async ({ page }) => {
  await signIn(page, "st-electrical");
  await page.getByRole("navigation", { name: "Quick" }).getByRole("link", { name: "History" }).click();
  await expect(page.getByText("Tap a breakdown to see what was found and what was tried.")).toBeVisible();
  await expect(page.getByText("Work order context")).toHaveCount(0); // nothing opens by itself
  const first = page.getByRole("main").getByRole("button").filter({ hasText: /KPC-DMO-/ }).first();
  await first.click();
  await expect(page.getByText("Work order context")).toBeVisible();
  await expectNoSidewaysScroll(page, "fault detail");
  await page.getByRole("button", { name: "Back to list" }).click();
  await expect(page.getByText("Tap a breakdown to see what was found and what was tried.")).toBeVisible();
});

test("form fields use 16px text so phones do not zoom in", async ({ page }) => {
  await signIn(page, "operations");
  await page.goto("/report");
  const size = await page.getByLabel("1. Which equipment?").evaluate((field) => getComputedStyle(field).fontSize);
  expect(parseFloat(size)).toBeGreaterThanOrEqual(16);
  await expect(page.getByText("Take a photo")).toBeVisible();
});
