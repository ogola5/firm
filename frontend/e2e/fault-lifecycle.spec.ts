/**
 * Scenarios 1–3 (MASTER BUILD PROMPT §16), driven through the UI:
 *   1. First-time fault: report → Systems Automation → Electrical → investigation
 *      → restoration → procedure → technical review → publication → library.
 *   2. Recurring fault: the same problem again shows history, ranked causes and
 *      the approved procedure, which is reused and its outcome recorded.
 *   3. Failed intervention: the failed and successful attempts both remain and
 *      the supervisor sees the complete investigation before publishing.
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiToken, cardWithHeading, equipmentIn, openFault, signIn, userId, type Row } from "./helpers";

test.describe.configure({ mode: "serial" });

const run = Date.now();
const symptom = `E2E valve fails to open on command ${run}`;
const cause = `Loose actuator supply terminal ${run}`;
const procedureTitle = `Actuator supply check for stuck valve ${run}`;
let faultId = "";
let equipment: Row;

test("Scenario 1 + 3: first-time fault to published knowledge, keeping the failed attempt", async ({ page, request }) => {
  test.setTimeout(300_000);
  equipment = await equipmentIn(request, "Electrical");

  // Operations reports, identifying the asset with certainty.
  await signIn(page, "operations");
  await page.goto("/faults?mode=report");
  await page.getByLabel("Equipment tag or description").fill(String(equipment.tag));
  await page.getByRole("button", { name: new RegExp(`^${String(equipment.tag)} ·`) }).first().click();
  await page.getByLabel("I am sure this is the exact equipment").check();
  await page.getByLabel("What is happening?").fill(symptom);
  await page.getByLabel("Effect on operation").fill("Transfer delayed (synthetic)");
  await page.getByRole("button", { name: "Submit breakdown" }).click();
  await expect(page.getByText(/Breakdown reported: KPC-DMO-\d+/)).toBeVisible();
  faultId = new URL(page.url()).searchParams.get("fault")!;
  expect(faultId).toBeTruthy();

  // Systems Automation responds first, then hands its findings to Electrical.
  await signIn(page, "automation");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("Fault acknowledge recorded.")).toBeVisible();
  await page.getByLabel("Next section", { exact: true }).selectOption("Electrical");
  await page.getByLabel("What did your section find?").fill("SCADA command reaches the RTU; no actuator response.");
  await page.getByLabel("What should the next section do?").fill("Check actuator supply and terminals.");
  await page.getByRole("button", { name: "Send with findings" }).click();
  await expect(page.getByText("Findings handed to Electrical")).toBeVisible();

  // The Systems Automation chief approves the handoff.
  await signIn(page, "ct-systems-automation");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Approve escalation" }).click();
  await expect(page.getByText("Chief technical review approved.")).toBeVisible();

  // The Electrical chief allocates the work.
  const technicianId = await userId(request, "st-electrical");
  await signIn(page, "ct-electrical");
  await openFault(page, faultId);
  await page.getByLabel("Assigned technician").selectOption(technicianId);
  await page.getByLabel("Expected response by").fill("2030-01-15T10:00");
  await page.getByRole("button", { name: "Assign work" }).click();
  await expect(page.getByText("Section assignment and response target saved.")).toBeVisible();

  // The technician investigates: one diagnosis, a failed then a successful intervention.
  await signIn(page, "st-electrical");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("Fault acknowledge recorded.")).toBeVisible();
  const diagnosisForm = page.locator("form", { hasText: "Record possible cause and checks" });
  await diagnosisForm.getByLabel("Possible cause").fill(cause);
  await diagnosisForm.getByLabel("Diagnostic method").fill("Continuity test at the actuator junction box");
  await diagnosisForm.getByLabel("Quick check").fill("Measure 24 V DC at terminal X1");
  await diagnosisForm.getByRole("button", { name: "Save diagnosis" }).click();
  await expect(page.getByText("Diagnosis recorded.")).toBeVisible();
  const interventionForm = page.locator("form", { hasText: "Record each intervention" });
  await interventionForm.getByLabel("Related diagnosis").selectOption({ label: cause });
  await interventionForm.getByLabel("Action taken").fill("Reset the actuator controller");
  await interventionForm.getByLabel("Outcome").selectOption("FAILED");
  await interventionForm.getByRole("button", { name: "Save intervention" }).click();
  await expect(page.getByText("Intervention recorded; failed attempts remain in the history.")).toBeVisible();
  await interventionForm.getByLabel("Related diagnosis").selectOption({ label: cause });
  await interventionForm.getByLabel("Action taken").fill("Tightened and replaced the supply terminal");
  await interventionForm.getByLabel("Outcome").selectOption("SUCCESS");
  await interventionForm.getByRole("button", { name: "Save intervention" }).click();
  const log = cardWithHeading(page, "Investigation and intervention log");
  await expect(log.getByText("FAILED intervention")).toBeVisible();
  await expect(log.getByText("SUCCESS intervention")).toBeVisible();
  await page.getByRole("button", { name: "Request technical completion review" }).click();
  await expect(page.getByText("Work is waiting for Chief Technician review.")).toBeVisible();

  // The Electrical chief approves technical completion; Operations confirms service.
  await signIn(page, "ct-electrical");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Approve technical completion" }).click();
  await expect(page.getByText("Chief technical review approved.")).toBeVisible();
  await signIn(page, "operations");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Confirm restored and close" }).click();
  await expect(page.getByText("Operational restoration confirmed")).toBeVisible();

  // The technician turns the fix into a reusable procedure.
  await signIn(page, "st-electrical");
  await openFault(page, faultId);
  await page.getByLabel("Procedure title").fill(procedureTitle);
  await page.getByLabel("Observed symptom").fill(symptom);
  await page.getByLabel("Confirmed cause").fill(cause);
  await page.getByLabel("Diagnostic procedure").fill("Measure supply voltage at X1 before resetting anything.");
  await page.getByLabel("Corrective action", { exact: true }).fill("Tighten or replace the supply terminal; verify 24 V DC.");
  await page.getByRole("button", { name: "Submit for chief technical review" }).click();
  await expect(page.getByText("Work-procedure update submitted for chief technical review.")).toBeVisible();

  // Technical review, then supervisor publication with the full investigation in view.
  await signIn(page, "ct-electrical");
  await page.goto("/approvals");
  await cardWithHeading(page, procedureTitle).getByRole("button", { name: "Approve technical review" }).click();
  await expect(page.getByText("Technical review approved; awaiting supervisor publication.")).toBeVisible();
  await signIn(page, "supervisor");
  await page.goto("/approvals");
  const reviewCard = cardWithHeading(page, procedureTitle);
  await expect(reviewCard.getByText("FAILED:")).toBeVisible(); // Scenario 3: failed attempt visible to the approver
  await expect(reviewCard.getByText("SUCCESS:")).toBeVisible();
  await reviewCard.getByRole("button", { name: "Approve & publish" }).click();
  await expect(page.getByText("Procedure published to the approved library.")).toBeVisible();

  // The approved procedure is in the library.
  await signIn(page, "st-electrical");
  await page.goto("/knowledge");
  await page.getByLabel("Search knowledge").fill(procedureTitle);
  await expect(page.getByRole("heading", { name: procedureTitle })).toBeVisible();
});

test("Scenario 2: a recurring fault surfaces history and reuses the approved procedure", async ({ page, request }) => {
  test.setTimeout(180_000);
  expect(faultId, "Scenario 1 must run first").toBeTruthy();

  await signIn(page, "operations");
  await page.goto("/faults?mode=report");
  await page.getByLabel("Equipment tag or description").fill(String(equipment.tag));
  await page.getByRole("button", { name: new RegExp(`^${String(equipment.tag)} ·`) }).first().click();
  await page.getByLabel("I am sure this is the exact equipment").check();
  await expect(page.getByText("SEEN BEFORE:")).toBeVisible();
  await page.getByLabel("What is happening?").fill(symptom);
  await page.getByLabel("Effect on operation").fill("Transfer delayed again (synthetic)");
  await page.getByRole("button", { name: "Submit breakdown" }).click();
  await expect(page.getByText(/Breakdown reported: KPC-DMO-\d+/)).toBeVisible();
  const repeatId = new URL(page.url()).searchParams.get("fault")!;

  await signIn(page, "automation");
  await openFault(page, repeatId);
  await expect(page.getByText(/Seen before on this equipment: \d+ earlier report/)).toBeVisible();
  const ranked = cardWithHeading(page, "Most likely causes and confirmed fixes");
  await expect(ranked.getByText(cause)).toBeVisible();
  const history = cardWithHeading(page, "Reported history on this equipment");
  await expect(history.getByText("Reset the actuator controller")).toBeVisible(); // previous failed attempt
  const procedures = cardWithHeading(page, "Approved procedures for this equipment or symptom");
  await expect(procedures.getByRole("heading", { name: procedureTitle })).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await procedures.locator("article").filter({ hasText: procedureTitle }).getByRole("button", { name: "Record use on this fault" }).click();
  await expect(page.getByText("Procedure use recorded.")).toBeVisible();
  await expect(cardWithHeading(page, "Procedure reuse and outcome confirmation").getByText(procedureTitle)).toBeVisible();

  // Recurrence intelligence counts the repeat from the database.
  const token = await apiToken(request, "maintenance-manager");
  const insight = await apiGet<{ repeat_count: number }>(request, token, `/api/v1/intelligence/equipment/${String(equipment.id)}`);
  expect(insight.repeat_count).toBeGreaterThanOrEqual(2);
});
