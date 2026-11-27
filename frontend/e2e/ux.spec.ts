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
    send_to: "Systems Automation",
  });

  const page = await phone(browser);
  await signIn(page, "automation");
  // Home: one list of what needs this person.
  const needs = page.getByLabel("Needs you now");
  await expect(needs.getByRole("link").first()).toBeVisible();
  const showAll = needs.getByRole("button", { name: /Show all/ });
  if (await showAll.isVisible()) await showAll.click(); // oldest first: the newest may be beyond the first five
  // Someone already on a job is not shown other new (non-safety) faults until it is done.
  const jobs = await apiGet<Record<string, unknown[]>>(request, await apiToken(request, "automation"), "/api/v1/me/jobs");
  const busy = jobs.to_write_up.length + jobs.assigned.length + jobs.helping.length > 0;
  if (busy) await expect(needs.getByText(new RegExp(fault.reference))).toHaveCount(0);
  else await expect(needs.getByText(new RegExp(fault.reference)).first()).toBeVisible();
  await page.screenshot({ path: `${dir}/1-needs-you-now-phone.png`, fullPage: true });

  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  const progress = page.getByRole("list", { name: "Progress" });
  await expect(progress.locator('[aria-current="step"]')).toContainText("With Systems Automation");
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

test("anyone free takes another section's job and calls a colleague in to help", async ({ page, request }) => {
  const operations = await apiToken(request, "operations");
  const strainer = (await apiGet<Row[]>(request, operations, "/api/v1/equipment?search=11-STR-601")).find((row) => row.tag === "11-STR-601")!;
  const fault = await apiPost<{ id: string; assigned_section: string }>(request, operations, "/api/v1/faults", {
    equipment_id: strainer.id, symptom: "Blocked / no flow", operational_impact: "Running reduced: Working, but limited",
  });
  expect(fault.assigned_section).toBe("Mechanical"); // straight to the section that looks after it

  await signIn(page, "st-electrical");
  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  const next = page.getByRole("region", { name: "Next step" });
  await expect(next.getByText("Sent to Mechanical. If you are free, you can take it.")).toBeVisible();
  await next.getByRole("button", { name: "Take this job" }).click();
  await expect(page.getByText("You have taken this job.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Progress" }).locator('[aria-current="step"]')).toContainText("Taken");

  await next.getByRole("button", { name: "Call someone to help" }).click();
  const helpers = page.getByRole("region", { name: "Helping on this job" });
  await helpers.getByRole("button", { name: "Call someone to help" }).click();
  const who = helpers.getByLabel("Who");
  await expect(who.locator("option", { hasText: "(Mechanical, Nairobi)" }).first()).toBeAttached();
  const options = await who.locator("option").allTextContents();
  await who.selectOption({ label: options.find((text) => text.includes("Senior Technician") && text.includes("(Mechanical, Nairobi)"))! });
  await helpers.getByLabel(/What you need/).fill("Second pair of hands on the strainer cover");
  await helpers.getByRole("button", { name: "Call in" }).click();
  await expect(page.getByText(/has been asked to help/)).toBeVisible();
  await expect(helpers.getByText(/Mechanical · Second pair of hands/)).toBeVisible();
  await page.screenshot({ path: `${dir}/6-call-someone-in.png` });

  // The helper sees it in My jobs.
  await signIn(page, "st-mechanical");
  await expect(page.getByRole("region", { name: "Helping a colleague" }).locator(`a[href="/jobs/${fault.id}/card"]`)).toBeVisible();
});

test("the Chief Technician's note reaches whoever takes the job; asking for help reaches the Chief Technician", async ({ page, request }) => {
  const operations = await apiToken(request, "operations");
  const valve = (await apiGet<Row[]>(request, operations, "/api/v1/equipment?search=11-MOV-501")).find((row) => row.tag === "11-MOV-501")!;
  const fault = await apiPost<{ id: string; reference: string }>(request, operations, "/api/v1/faults", {
    equipment_id: valve.id, symptom: "Won't open / close", operational_impact: "Running reduced: Working, but limited",
  });
  const note = `Check the torque switch first ${Date.now()}`;

  await signIn(page, "ct-electrical");
  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  const notes = page.getByRole("region", { name: "Notes on this job" }).or(page.getByLabel("Notes on this job"));
  await notes.getByLabel("Add a note").fill(note);
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note sent to whoever is on the job.")).toBeVisible();

  await signIn(page, "pt-electrical");
  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  await page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Take this job" }).click();
  await expect(page.getByText("You have taken this job.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Next step" })).toContainText("Read the note on this job first");
  await expect(notes).toContainText(note);
  await notes.getByLabel("Add a note").fill("The gearbox is seized; can we replace it?");
  await notes.getByLabel("Ask the Chief Technician for help").check();
  await notes.getByRole("button", { name: "Send and ask" }).click();
  await expect(page.getByText("Sent. Your Chief Technician has been asked.")).toBeVisible();
  await page.screenshot({ path: `${dir}/7-notes-on-the-job.png` });

  // Home: the job now comes first; its note is on it.
  await page.goto("/dashboard");
  const current = page.getByRole("region", { name: "To write up" }).locator("article").filter({ has: page.locator(`a[href="/jobs/${fault.id}/card"]`) });
  await expect(current).toContainText("The gearbox is seized");

  await signIn(page, "ct-electrical");
  const needs = page.getByLabel("Needs you now");
  await expect(needs.getByRole("link").first()).toBeVisible();
  const showAll = needs.getByRole("button", { name: /Show all/ });
  if (await showAll.isVisible()) await showAll.click();
  await expect(needs.getByRole("link", { name: new RegExp(`Help asked by .*${fault.reference}`) })).toBeVisible();
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
