/**
 * Analytics and intelligence: who sees what, every figure carries its n,
 * comparisons are in words, and similar faults explain why they ranked.
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiToken, openFault, signIn, type Row } from "./helpers";

test("manager sees trends, attention list and data quality for all sections", async ({ page }) => {
  await signIn(page, "maintenance-manager");
  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();

  const headline = page.getByRole("region", { name: "Headline measures" });
  await expect(headline.getByText("Time to restore")).toBeVisible();
  await expect(headline.getByText(/fault\(s\) behind this figure/).first()).toBeVisible();
  // A comparison is always stated in words, never by colour alone.
  await expect(headline.getByText(/than the previous 12 weeks|Too few faults to compare|Same as the previous|No data to compare/).first()).toBeVisible();

  const trends = page.getByRole("region", { name: "Trends" });
  await expect(trends.getByRole("img").first()).toBeVisible();
  await trends.getByText(/Show as table/).first().click();
  await expect(trends.locator("details[open] table").first()).toBeVisible();
  // The current week is cut short by today (unless today is Sunday): it is flagged, not shown as a drop.
  if (new Date().getDay() !== 0) await expect(trends.locator("details[open]").first().getByText(/of 7 days\)/).first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Equipment needing attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How complete are the records?" })).toBeVisible();

  await page.getByRole("button", { name: "Last 12 months" }).click();
  // The demo history covers one year, so the 12 months before have no records: "No data to compare".
  await expect(headline.getByText(/previous 12 months|Too few faults to compare|No data to compare/).first()).toBeVisible();
  await page.getByLabel("Section").selectOption("Mechanical");
  await expect(page.getByText(/Mechanical section/).first()).toBeVisible();
});

test("executive sees headline and trends only; field technicians have no analytics", async ({ page }) => {
  await signIn(page, "ceo");
  await page.goto("/analytics");
  await expect(page.getByRole("region", { name: "Headline measures" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Equipment needing attention" })).toHaveCount(0);

  await signIn(page, "st-electrical");
  await expect(page.getByRole("link", { name: "Analytics" })).toHaveCount(0);
});

test("a technician sees similar earlier faults with the reasons they ranked", async ({ page, request }) => {
  const token = await apiToken(request, "st-electrical");
  const faults = await apiGet<Row[]>(request, token, "/api/v1/faults?search=11-MOV");
  expect(faults.length).toBeGreaterThan(0);
  await signIn(page, "st-electrical");
  await openFault(page, String(faults[0].id));
  const panel = page.getByRole("region", { name: "Similar earlier faults" });
  await expect(panel.getByText("Similar is not the same cause. Check before you act.")).toBeVisible();
  await expect(panel.getByText(/Same equipment|Same type of equipment|Same problem described|Similar problem description|Same fault category|Nothing similar enough/).first()).toBeVisible();
});
