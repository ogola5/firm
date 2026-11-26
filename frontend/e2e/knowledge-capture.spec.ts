/**
 * Retiring expertise, drawing differences, points and awards, and the "likely to fail" list.
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiPost, apiToken, signIn, type Row } from "./helpers";

const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main" });

test("a technician sees what is likely to fail, with reasons and how often the list has been right", async ({ page }) => {
  await signIn(page, "st-instrumentation");
  await expect(page.getByText(/Likely to need attention in/)).toBeVisible();
  await nav(page).getByRole("link", { name: "Likely to fail" }).click();
  await expect(page.getByRole("heading", { name: "Likely to fail" })).toBeVisible();
  // Every listed item says why.
  await expect(page.getByRole("article", { name: /likely to need attention/ }).first().getByRole("listitem").first()).toBeVisible();
  await expect(page.getByText(/of listed equipment failed within 30 days/)).toBeVisible();
});

test("a chief verifies a drawing difference; it reaches the job card and earns the reporter points", async ({ page, request }) => {
  const technician = await apiToken(request, "st-electrical");
  const equipment = (await apiGet<Row[]>(request, technician, "/api/v1/equipment?search=11-MOV-602")).find((row) => row.tag === "11-MOV-602")!;
  const description = `Open limit switch moved to terminal X${Date.now() % 90 + 10}; drawing shows X2`;
  await apiPost(request, technician, `/api/v1/equipment/${equipment.id}/drawing-differences`, {
    description, drawing_number: "ILL-PS02-E-0413", permanence: "PERMANENT",
  });

  await signIn(page, "ct-electrical");
  await nav(page).getByRole("link", { name: "Drawing differences" }).click();
  const row = page.getByRole("article").filter({ hasText: description });
  await row.getByRole("button", { name: "Verified: it differs" }).click();
  await expect(page.getByText(/Verified: it now shows on every job card/)).toBeVisible();

  await signIn(page, "st-electrical");
  await nav(page).getByRole("link", { name: "My points & awards" }).click();
  await expect(page.getByText(`Drawing difference verified: ${description}`)).toBeVisible();
});

test("an expert session goes from write-up to the library after the chief approves it", async ({ page }) => {
  const title = `Level transmitters: night drift ${Date.now() % 10000}`;
  await signIn(page, "st-instrumentation");
  await nav(page).getByRole("link", { name: "Expert knowledge" }).click();
  await expect(page.getByRole("article", { name: /in (Instrumentation|Systems Automation|Electrical|Mechanical)/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Expert sessions" }).click();
  await page.getByText("Write up an expert session").click();
  const expert = page.getByLabel("Expert", { exact: true });
  await expect(expert.locator("option", { hasText: "Senior Engineer (Instrumentation, Nairobi)" })).toHaveCount(1);
  const options = await expert.locator("option").allTextContents();
  await expert.selectOption({ label: options.find((text) => text.includes("Senior Engineer (Instrumentation, Nairobi)"))! });
  await page.getByLabel("Section", { exact: true }).selectOption("Instrumentation");
  await page.getByLabel("Equipment type", { exact: true }).selectOption("LT");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("How it usually fails").fill("Condensation in the housing on cold nights.");
  await page.getByLabel("First checks, in order").fill("1. Manual dip. 2. Open the housing and look for water.");
  await page.getByRole("button", { name: "Send to the section chief" }).click();
  await expect(page.getByText("Sent to the section chief.")).toBeVisible();

  await signIn(page, "ct-instrumentation");
  await page.goto("/expertise?tab=sessions");
  await page.getByRole("article", { name: title }).getByRole("button", { name: "Approve into the library" }).click();
  await expect(page.getByText("Decision saved.")).toBeVisible();
  await expect(page.getByRole("article", { name: title }).getByText("In the library")).toBeVisible();
});

test("HR sets a retirement date, redeems points and records an award the whole company can see", async ({ page }) => {
  await signIn(page, "hr");
  await nav(page).getByRole("link", { name: "Expert knowledge" }).click();
  await page.getByRole("button", { name: "Retirement dates" }).click();
  const dateField = page.getByLabel(/Retirement date for Demo Chief Engineer \(Mechanical\)/);
  await dateField.fill("2028-09-30");
  await dateField.locator("xpath=..").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Saved for Demo Chief Engineer \(Mechanical\)/)).toBeVisible();

  await nav(page).getByRole("link", { name: "Recognition" }).click();
  const table = page.getByRole("table");
  const redeemable = table.getByRole("button", { name: "Redeem…" }).first();
  await redeemable.click();
  const group = page.getByRole("group", { name: /Redeem points for/ });
  await group.getByLabel("Points").fill("5");
  await group.getByLabel("As").selectOption("VOUCHER");
  await group.getByLabel("Value").fill("Voucher (illustrative)");
  await group.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("Redemption recorded; the person has been emailed.")).toBeVisible();

  await page.getByRole("button", { name: "Employee of the Quarter" }).click();
  const candidate = page.getByRole("main").getByRole("radio").first(); // not the display-mode switch in the menu
  if (await candidate.count()) {
    await candidate.check();
    await page.getByLabel("Citation (what they did)").fill("Procedures colleagues used to fix repeat faults first time.");
    await page.getByLabel("Prize").fill("Certificate (illustrative)");
    await page.getByRole("button", { name: "Record award" }).click();
    await expect(page.getByText("Award recorded; the winner has been emailed.")).toBeVisible();
  }

  await signIn(page, "st-mechanical");
  await nav(page).getByRole("link", { name: "My points & awards" }).click();
  await expect(page.getByRole("heading", { name: /Awards/ })).toBeVisible();
  await expect(page.getByRole("article", { name: /Employee of the/ }).first()).toBeVisible();
});
