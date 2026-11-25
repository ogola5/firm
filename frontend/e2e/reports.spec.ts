/**
 * Weekly, monthly and financial-year reports: each level gets its version,
 * it can be printed, and it arrives by email (demo mailbox).
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the manager reads, prints and emails the financial-year report", async ({ page }) => {
  await signIn(page, "maintenance-manager");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" }).click();
  const report = page.getByRole("article", { name: "Report" });
  await expect(report.getByRole("heading", { name: /^Weekly report: Week of/ })).toBeVisible();

  await page.getByRole("button", { name: /Financial year/ }).click();
  await expect(report.getByRole("heading", { name: /^Financial year report: Financial year \d{4}\/\d{2}$/ })).toBeVisible();
  await expect(report.getByText(/1 Jul \d{4} – 30 Jun \d{4}/)).toBeVisible();
  await expect(report.getByText(/compared with the same period of FY/)).toBeVisible();
  for (const heading of ["Headline", "Trend", "Sections", "Equipment needing attention", "How complete are the records?"]) {
    await expect(report.getByRole("heading", { name: heading })).toBeVisible();
  }

  // Printing shows only the report (menu and controls are hidden on paper).
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(report).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "Email it to me" }).click();
  await expect(page.getByText("Sent to demo.maintenance-manager@kpc.co.ke.")).toBeVisible();
  await page.goto("/mailbox?email=demo.maintenance-manager%40kpc.co.ke");
  await expect(page.getByRole("heading", { name: /^Financial year report: Financial year .* — All sections$/ }).first()).toBeVisible();
});

test("a chief technician gets their own section; the CEO gets the headline version", async ({ page }) => {
  await signIn(page, "ct-mechanical");
  await page.goto("/reports?kind=month&section=Electrical");
  const report = page.getByRole("article", { name: "Report" });
  await expect(report.getByText("KPC Maintenance · Mechanical section")).toBeVisible();
  await expect(page.getByLabel("Section")).toHaveCount(0);

  await signIn(page, "ceo");
  await page.goto("/reports?kind=year");
  await expect(report.getByRole("heading", { name: "Headline" })).toBeVisible();
  await expect(report.getByText(/Executive version: headline figures and trends only/)).toBeVisible();
  await expect(report.getByRole("heading", { name: "Equipment needing attention" })).toHaveCount(0);

  await page.goto("/account");
  await expect(page.getByLabel("Financial year report")).toBeChecked();
  await expect(page.getByLabel("Weekly report")).not.toBeChecked();
});
