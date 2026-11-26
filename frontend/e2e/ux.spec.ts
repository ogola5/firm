/**
 * The redesigned experience: progress and next step on a fault, tabs, toasts, "Needs you now",
 * header search to an equipment page, night mode, and the guided demo for presentations.
 * Screenshots go to screens/ux/.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiGet, apiPost, apiToken, showTab, signIn, type Row } from "./helpers";

const dir = "screens/ux";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function phone(browser: Browser): Promise<Page> {
  return (await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL })).newPage();
}

test("a fault shows where it is and the one next step; tabs hold the rest", async ({ browser, request }) => {
  const operations = await apiToken(request, "operations");
  const valve = (await apiGet<Row[]>(request, operations, "/api/v1/equipment?search=11-MOV-602")).find((row) => row.tag === "11-MOV-602")!;
  const fault = await apiPost<{ id: string; reference: string }>(request, operations, "/api/v1/faults", {
    equipment_id: valve.id, symptom: "Won't open / close", operational_impact: "Running reduced: Working, but limited",
  });

  const page = await phone(browser);
  await signIn(page, "automation");
  // Home: one list of what needs this person.
  const needs = page.getByLabel("Needs you now");
  await expect(needs.getByText(new RegExp(fault.reference)).first()).toBeVisible();
  await page.screenshot({ path: `${dir}/1-needs-you-now-phone.png`, fullPage: true });

  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  const progress = page.getByRole("list", { name: "Progress" });
  await expect(progress.locator('[aria-current="step"]')).toContainText("Sorted");
  const next = page.getByRole("region", { name: "Next step" });
  await expect(next.getByText("Waiting to be taken")).toBeVisible();
  await page.screenshot({ path: `${dir}/2-fault-next-step-phone.png` });
  await next.getByRole("button", { name: "Take this job" }).click();
  await expect(page.getByText("You have taken this job.")).toBeVisible(); // toast near the thumb
  await expect(progress.locator('[aria-current="step"]')).toContainText("Taken");
  await showTab(page, "What we know");
  await expect(page.getByRole("region", { name: "Similar earlier faults" })).toBeVisible();
  await showTab(page, "History");
  await expect(page.getByRole("heading", { name: "What happened, in order" })).toBeVisible();
});

test("search from the header goes to the equipment's own page; reporting from there starts with it", async ({ page }) => {
  await signIn(page, "operations");
  const search = page.getByRole("combobox", { name: "Search equipment, faults and the library" });
  await search.fill("pump 401");
  await page.getByRole("option").filter({ hasText: "11-P-401" }).first().click();
  await expect(page.getByRole("heading", { name: /11-P-401 · Line 4 main pump A/ })).toBeVisible();
  await expect(page.getByLabel("What has happened before")).toBeVisible();
  await expect(page.getByRole("link", { name: /Part of Line 4 pump A unit/ })).toBeVisible();
  await page.screenshot({ path: `${dir}/3-equipment-page.png`, fullPage: true });
  await page.getByRole("link", { name: "Report a fault on this" }).click();
  await expect(page.getByText("11-P-401 · Line 4 main pump A (pump 401)", { exact: true })).toBeVisible();
});

test("night mode for night shifts, kept on this device", async ({ page }) => {
  await signIn(page, "ct-electrical");
  await page.goto("/account");
  await page.getByRole("radiogroup", { name: "Display" }).last().getByRole("radio", { name: "Night" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await page.screenshot({ path: `${dir}/4-night-mode.png`, fullPage: true });
  await page.goto("/account");
  await page.getByRole("radiogroup", { name: "Display" }).last().getByRole("radio", { name: "Day" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("the guided demo switches person and screen, chapter by chapter", async ({ page }) => {
  await page.goto("/tour");
  await expect(page.getByRole("heading", { name: "One fault, from report to knowledge" })).toBeVisible();
  await page.screenshot({ path: `${dir}/5-guided-demo.png`, fullPage: true });
  await page.getByRole("listitem").filter({ hasText: "The fix becomes knowledge" }).getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/\/library\/PUMP/);
  const bar = page.getByRole("complementary", { name: "Guided demo" });
  await expect(bar.getByText(/Demo 7\/11: The fix becomes knowledge/)).toBeVisible();
  await bar.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/library\/systems\/SYS-L4-PUMP-A/);
  await expect(page.getByRole("heading", { name: "Line 4 pump A unit" })).toBeVisible();
  await page.getByRole("complementary", { name: "Guided demo" }).getByRole("button", { name: "End the demo" }).click();
  await expect(page.getByRole("complementary", { name: "Guided demo" })).toHaveCount(0);
});
