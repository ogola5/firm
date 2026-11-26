/**
 * The bell: a new fault reaches Systems Automation on their phone; opening it goes to the fault
 * and marks it read. Version history: anyone can compare versions of a procedure from the library.
 * Screenshots go to screens/notifications/.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiGet, apiPost, apiToken, signIn, type Row } from "./helpers";

const dir = "screens/notifications";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function phone(browser: Browser): Promise<Page> {
  return (await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL })).newPage();
}

test("a new fault rings Systems Automation's bell; opening it goes to the fault and marks it read", async ({ browser, request }) => {
  const automationToken = await apiToken(request, "automation");
  await apiPost(request, automationToken, "/api/v1/notifications/read-all", {});
  const operations = await apiToken(request, "operations");
  const valve = (await apiGet<Row[]>(request, operations, "/api/v1/equipment?search=11-MOV-602")).find((row) => row.tag === "11-MOV-602")!;
  const fault = await apiPost<{ id: string; reference: string }>(request, operations, "/api/v1/faults", {
    equipment_id: valve.id, symptom: "Won't open / close", operational_impact: "Running reduced: Working, but limited",
  });

  const page = await phone(browser);
  await signIn(page, "automation");
  const bell = page.getByRole("link", { name: /Notifications, \d+ unread/ });
  await expect(bell).toBeVisible();
  await page.screenshot({ path: `${dir}/1-bell-phone.png` });
  await bell.click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  const item = page.getByRole("button", { name: new RegExp(`Unread: New fault: ${fault.reference}`) });
  await expect(item).toBeVisible();
  await page.screenshot({ path: `${dir}/2-list-phone.png`, fullPage: true });
  await item.click();
  await expect(page).toHaveURL(new RegExp(`fault=${fault.id}`));
  await page.goto("/notifications");
  await expect(page.getByRole("button", { name: new RegExp(`^New fault: ${fault.reference}`) })).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications" })).toBeVisible(); // no unread left
});

test("anyone can compare versions of a procedure from the library", async ({ page }) => {
  await signIn(page, "st-instrumentation");
  await page.goto("/library/LT");
  await page.getByRole("link", { name: /compare 2 versions/ }).first().click();
  await expect(page.getByRole("heading", { name: /cable gland/ })).toBeVisible();
  const diff = page.getByLabel("Changes from v1 to v2");
  await expect(diff.getByText(/Check the cable gland/).first()).toBeVisible();
  await expect(page.getByText(/Why it changed:.*cable/).first()).toBeVisible();
  await expect(page.getByText(/Published by/).first()).toBeVisible();
  await page.screenshot({ path: `${dir}/3-versions.png`, fullPage: true });
});
