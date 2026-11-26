/**
 * Scenarios 1–3 (MASTER BUILD PROMPT §16), driven through the desk workflow:
 *   1. First-time fault: control-room report → Systems Automation → Electrical →
 *      job card → visit write-up with real times → sign-off → Operations confirms
 *      → procedure drafted from the write-up → technical review → publication.
 *   2. Recurring fault: the same problem again shows "seen before", earlier
 *      attempts, ranked causes and the approved procedure, which is reused.
 *   3. Failed intervention: the failed and successful attempts both remain and
 *      the supervisor sees the complete investigation before publishing.
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiToken, cardWithHeading, equipmentIn, openFault, showTab, signIn, userId, type Row } from "./helpers";

test.describe.configure({ mode: "serial" });

const run = Date.now();
const cause = `Loose actuator supply terminal ${run}`;
const procedureTitle = `Drive won't start: check supply terminal first ${run}`;
let faultId = "";
let equipment: Row;

async function reportFromControlRoom(page: import("@playwright/test").Page, tag: string, alarm: string) {
  await page.goto("/report");
  await page.getByLabel("1. Which equipment?").fill(tag);
  await page.getByRole("button", { name: "Yes, this one" }).click();
  await page.getByRole("group", { name: "Where did you see it" }).getByRole("button", { name: "On SCADA" }).click();
  await page.getByRole("group", { name: "What is wrong" }).getByRole("button", { name: "Stopped / tripped" }).click();
  // The follow-up questions for a trip: what the alarm said and whether a reset worked.
  await page.getByLabel("Alarm or trip shown").fill(alarm);
  await page.getByRole("group", { name: "Reset" }).getByRole("button", { name: "Tried, didn't work" }).click();
  await page.getByRole("group", { name: "Effect on operation" }).getByRole("button", { name: /^Stopped/ }).click();
  await page.getByRole("group", { name: "Equipment state now" }).getByRole("button", { name: "Stopped" }).click();
  await page.getByRole("group", { name: "Anyone or anything at risk" }).getByRole("button", { name: /^No$/ }).click();
  await page.getByRole("group", { name: "Already done" }).getByRole("button", { name: /Reset from SCADA/ }).click();
  await page.getByLabel(/Reach me on/).fill("ext 2231");
  // The written report is composed from the answers.
  const preview = page.getByRole("region", { name: "Your report will read" });
  await expect(preview).toContainText(`Alarm/trip shown: ${alarm}; reset tried, didn't work.`);
  await expect(preview).toContainText("Already done: reset from SCADA.");
  await expect(preview).toContainText("Reach the reporter on ext 2231.");
}

test("Scenario 1 + 3: first-time fault to published knowledge, keeping the failed attempt", async ({ page, request }) => {
  test.setTimeout(300_000);
  equipment = await equipmentIn(request, "Electrical");

  // Operations reports from the control room in four answers.
  await signIn(page, "operations");
  await reportFromControlRoom(page, String(equipment.tag), `SCADA: ${String(equipment.tag)} TRIP ${run}`);
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByRole("heading", { name: /Reported · KPC-DMO-\d+/ })).toBeVisible();
  await page.getByRole("link", { name: "Open this report" }).click();
  faultId = new URL(page.url()).searchParams.get("fault")!;
  expect(faultId).toBeTruthy();

  // Systems Automation responds first, then hands its findings to Electrical.
  await signIn(page, "automation");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Take this job" }).click();
  await expect(page.getByText("You have taken this job.")).toBeVisible();
  await page.getByLabel("Next section", { exact: true }).selectOption("Electrical");
  await page.getByLabel("What did your section find?").fill("SCADA command reaches the drive; no response.");
  await page.getByLabel("What should the next section do?").fill("Check the drive supply and terminals.");
  await page.getByRole("button", { name: "Send with findings" }).click();
  await expect(page.getByText("Findings handed to Electrical")).toBeVisible();

  await signIn(page, "ct-systems-automation");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Approve escalation" }).click();
  await expect(page.getByText("Chief technical review approved.")).toBeVisible();

  const technicianId = await userId(request, "st-electrical");
  await signIn(page, "ct-electrical");
  await openFault(page, faultId);
  await page.getByLabel("Assigned technician").selectOption(technicianId);
  await page.getByLabel("Expected response by").fill("2030-01-15T10:00");
  await page.getByRole("button", { name: "Assign work" }).click();
  await expect(page.getByText("Section assignment and response target saved.")).toBeVisible();

  // The technician takes the job from My jobs and prints the job card.
  await signIn(page, "st-electrical");
  await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
  // This job's row, identified by its own links (other jobs may be on the same equipment).
  const jobRow = (section: string) => page.getByRole("region", { name: section }).locator("article")
    .filter({ has: page.locator(`a[href="/jobs/${faultId}/card"]`) });
  await jobRow("Assigned to you, not visited yet").getByRole("button", { name: "I'm taking this job" }).click();
  await expect(page.getByText(`You have taken ${String(equipment.tag)}`)).toBeVisible();
  await jobRow("To write up").getByRole("link", { name: "Print job card" }).click();
  await expect(page.getByRole("article", { name: "Job card" })).toContainText(`SCADA: ${String(equipment.tag)} TRIP ${run}`);
  await expect(page.getByRole("button", { name: "Print job card" })).toBeVisible();

  // Back at the desk: write up the visit from the notebook, with real times.
  await page.goto("/dashboard");
  await jobRow("To write up").getByRole("link", { name: "Write up visit" }).click();
  const now = new Date();
  const hhmm = (minutesAgo: number) => {
    const moment = new Date(now.getTime() - minutesAgo * 60_000);
    return `${String(moment.getHours()).padStart(2, "0")}:${String(moment.getMinutes()).padStart(2, "0")}`;
  };
  // Keep both times on today's date (the report was made a few minutes ago).
  await page.getByLabel("Arrived on site", { exact: true }).fill(hhmm(0));
  await page.getByLabel("Back in service", { exact: true }).fill(hhmm(0));
  await page.getByLabel("What did you find?").fill(cause);
  await page.getByLabel("What kind of cause?").selectOption("loose_connection");
  await page.getByLabel("Step 1: what you did").fill("Reset the actuator controller");
  await page.getByLabel("Step 1: kind of action").selectOption("reset");
  await page.getByRole("group", { name: "Step 1: did it work?" }).getByRole("button", { name: "Didn't work" }).click();
  await page.getByRole("button", { name: "Add another thing you did" }).click();
  await page.getByLabel("Step 2: what you did").fill("Tightened and replaced the supply terminal");
  await page.getByRole("group", { name: "Step 2: did it work?" }).getByRole("button", { name: "Worked" }).click();
  await page.getByLabel("Step 2: kind of action").selectOption("tighten");
  // The supply terminal had been moved at some point: record it against the drawing.
  await page.getByRole("group", { name: "Differs from the drawing" }).getByRole("button", { name: "Yes" }).click();
  await page.getByLabel("What is different?").fill("Supply on terminal X4; drawing shows X1");
  await page.getByLabel(/Parts and materials used/).fill("1 x terminal block");
  await page.getByRole("button", { name: "Save and ask Chief to sign off" }).click();
  await expect(page.getByRole("heading", { name: "Sent to your Chief Technician for sign-off" })).toBeVisible();

  // Chief signs off; Operations confirms service.
  await signIn(page, "ct-electrical");
  await openFault(page, faultId);
  await showTab(page, "History");
  const log = cardWithHeading(page, "Checks and fixes tried");
  await expect(log.getByText("FAILED intervention")).toBeVisible();
  await expect(log.getByText("SUCCESS intervention")).toBeVisible();
  await page.getByRole("button", { name: "Approve technical completion" }).click();
  await expect(page.getByText("Chief technical review approved.")).toBeVisible();
  await signIn(page, "operations");
  await openFault(page, faultId);
  await page.getByRole("button", { name: "Yes, it works: close it" }).click();
  await expect(page.getByText("Operational restoration confirmed")).toBeVisible();

  // The procedure is drafted from the write-up: check it and send it.
  await signIn(page, "st-electrical");
  await page.getByRole("region", { name: "Turn your fix into a procedure" })
    .locator(`a[href="/jobs/${faultId}/procedure"]`).click();
  await expect(page.getByLabel(/Likely cause/)).toHaveValue(cause);
  await expect(page.getByLabel(/^Fix/)).toHaveValue("Tightened and replaced the supply terminal");
  await expect(page.getByLabel(/Don't bother with/)).toHaveValue(/Reset the actuator controller/);
  await page.getByLabel("Title").fill(procedureTitle);
  // If the library already has similar procedures, the draft asks whether this adds to one. Here it is new.
  const similar = page.getByLabel("Similar procedures");
  await page.waitForLoadState("networkidle");
  if (await similar.isVisible()) await similar.getByText("No, this is a different problem").click();
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByRole("heading", { name: "Sent for review" })).toBeVisible();

  // Technical review, then publication with the full investigation in view.
  await signIn(page, "ct-electrical");
  await page.goto("/approvals");
  await cardWithHeading(page, procedureTitle).getByRole("button", { name: "It's right: send for publishing" }).click();
  await expect(page.getByText("Technical review approved; awaiting supervisor publication.")).toBeVisible();
  await signIn(page, "supervisor");
  await page.goto("/approvals");
  const reviewCard = cardWithHeading(page, procedureTitle);
  await expect(reviewCard.getByText("FAILED:")).toBeVisible(); // Scenario 3: failed attempt visible to the approver
  await expect(reviewCard.getByText("SUCCESS:")).toBeVisible();
  await reviewCard.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Procedure published to the approved library.")).toBeVisible();

  await signIn(page, "st-electrical");
  await page.goto("/knowledge");
  await page.getByLabel("Search knowledge").fill(procedureTitle);
  await expect(page.getByRole("heading", { name: procedureTitle })).toBeVisible();
});

test("Scenario 2: a recurring fault surfaces history and reuses the approved procedure", async ({ page, request }) => {
  test.setTimeout(180_000);
  expect(faultId, "Scenario 1 must run first").toBeTruthy();

  await signIn(page, "operations");
  await reportFromControlRoom(page, String(equipment.tag), `SCADA: ${String(equipment.tag)} TRIP again ${run}`);
  await expect(page.getByText("Seen before:")).toBeVisible();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByRole("heading", { name: /Reported · KPC-DMO-\d+/ })).toBeVisible();
  await page.getByRole("link", { name: "Open this report" }).click();
  const repeatId = new URL(page.url()).searchParams.get("fault")!;

  await signIn(page, "automation");
  await openFault(page, repeatId);
  await expect(page.getByText(/Seen before on this equipment: \d+ earlier report/)).toBeVisible();
  await showTab(page, "What we know");
  await expect(cardWithHeading(page, "Most likely causes").getByText(cause)).toBeVisible();
  await expect(cardWithHeading(page, "Earlier faults on this equipment").getByText("Reset the actuator controller").first()).toBeVisible();
  const procedures = cardWithHeading(page, "Approved procedures");
  await expect(procedures.getByRole("heading", { name: procedureTitle })).toBeVisible();
  await page.getByRole("button", { name: "Take this job" }).click();
  await procedures.locator("article").filter({ hasText: procedureTitle }).getByRole("button", { name: "Record use on this fault" }).click();
  await expect(page.getByText("Procedure use recorded.")).toBeVisible();

  const token = await apiToken(request, "maintenance-manager");
  const insight = await apiGet<{ repeat_count: number }>(request, token, `/api/v1/intelligence/equipment/${String(equipment.id)}`);
  expect(insight.repeat_count).toBeGreaterThanOrEqual(2);
});
