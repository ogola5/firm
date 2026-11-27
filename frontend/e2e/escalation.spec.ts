/**
 * Escalation, as each person would do it: the Chief Technician asks the regional Senior
 * Engineer; the SE gives guidance and takes it to the section Chief Engineer, who only sees
 * what persists. Another region's SE never sees it. Screenshots go to screens/escalation/.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiGet, apiPost, apiToken, signIn, type Row } from "./helpers";

const dir = "screens/escalation";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function phone(browser: Browser): Promise<Page> {
  return (await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL })).newPage();
}

test("CT asks the regional SE, the SE takes it to the CE, the CE sees only what persists", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const operations = await apiToken(request, "operations");
  // Mechanical, Nairobi, never fixed recently (a fault on recently fixed equipment goes straight to the CE).
  const pump = (await apiGet<Row[]>(request, operations, "/api/v1/equipment?search=11-STR-601")).find((row) => row.tag === "11-STR-601")!;
  const fault = await apiPost<{ id: string; reference: string }>(request, operations, "/api/v1/faults", {
    equipment_id: pump.id, symptom: "Blocked strainer", severity: "High",
    operational_impact: "Stopped: Operation stopped or at risk",
    description: "Tank 601 inlet strainer blocked again; transfer flow very low.",
  });
  const reference = fault.reference;

  // 1. Chief Technician (Mechanical, Nairobi) asks the Senior Engineer, with a reason.
  await signIn(page, "ct-mechanical");
  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  await page.waitForLoadState("networkidle");
  const card = page.getByLabel("Escalation", { exact: true });
  await card.getByRole("button", { name: "Ask the Senior Engineer" }).click();
  await card.getByLabel("Why it needs the Senior Engineer").fill("Cleaned twice this week and it blocks again; needs an engineer's decision");
  // Not fullPage: the capture resizes the page, which would remount the open form.
  await page.screenshot({ path: `${dir}/1-ct-asks-se.png` });
  await card.getByRole("button", { name: "Escalate" }).click();
  await expect(card.getByText("Escalated to the Senior Engineer")).toBeVisible();
  await expect(card.getByRole("button", { name: "Ask the Senior Engineer" })).toHaveCount(0);

  // 2. Senior Engineer (Mechanical, Nairobi), on a phone: it is at the top of their home.
  const se = await phone(browser);
  await signIn(se, "senior-engineer-mechanical");
  const needs = se.getByLabel("Needs you now");
  await expect(needs.getByRole("link").first()).toBeVisible();
  const showAll = needs.getByRole("button", { name: /Show all/ });
  if (await showAll.isVisible()) await showAll.click(); // new untaken faults are listed too
  await expect(needs.getByRole("link", { name: new RegExp(reference) })).toBeVisible();
  await se.screenshot({ path: `${dir}/2-se-home.png`, fullPage: true });
  await needs.getByRole("link", { name: new RegExp(reference) }).click();
  const seCard = se.getByLabel("Escalation", { exact: true });
  await seCard.getByRole("button", { name: "Add guidance" }).click();
  await seCard.getByLabel(/Guidance for the Chief Technician/).fill("Check the upstream tank for sediment before cleaning again");
  await seCard.getByRole("button", { name: "Send guidance" }).click();
  await expect(seCard.getByText(/Check the upstream tank for sediment/)).toBeVisible();
  await seCard.getByRole("button", { name: "Escalate to the Chief Engineer" }).click();
  await seCard.getByLabel("What does it need?").selectOption("Needs a design change");
  await seCard.getByLabel("Details").fill("Strainer mesh is too fine for this product");
  await se.screenshot({ path: `${dir}/3-se-to-ce.png` });
  await seCard.getByRole("button", { name: "Escalate" }).click();
  await expect(seCard.getByText("Escalated to the Chief Engineer")).toBeVisible();

  // 3. Chief Engineer (whole Mechanical section): sees it because it persists.
  const ce = await phone(browser);
  await signIn(ce, "chief-engineer-mechanical");
  const ceNeeds = ce.getByLabel("Needs you now");
  await expect(ceNeeds.getByRole("link").first()).toBeVisible();
  const ceShowAll = ceNeeds.getByRole("button", { name: /Show all/ });
  if (await ceShowAll.isVisible()) await ceShowAll.click();
  await expect(ceNeeds.getByRole("link", { name: new RegExp(reference) })).toBeVisible();
  await ce.screenshot({ path: `${dir}/4-ce-home.png`, fullPage: true });
  await ce.getByRole("navigation", { name: "Quick" }).getByRole("link", { name: "Escalated" }).click();
  await expect(ce.getByRole("heading", { name: "Escalations" })).toBeVisible();
  await expect(ce.getByText(/Needs a design change: Strainer mesh/).first()).toBeVisible();
  await ce.screenshot({ path: `${dir}/5-ce-escalations.png`, fullPage: true });

  // 4. Another region's Senior Engineer does not see it.
  const coast = await phone(browser);
  await signIn(coast, "senior-engineer-mechanical-coast");
  await coast.goto("/escalations");
  await expect(coast.getByRole("heading", { name: "Escalations" })).toBeVisible();
  await expect(coast.getByText(reference)).toHaveCount(0);
});
