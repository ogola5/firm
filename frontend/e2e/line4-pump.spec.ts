/**
 * Real case, end to end, as each person would do it (phones for Operations and the technician):
 * Operations cannot start Line 4 pump A; Systems Automation's PT clears the latched trips and
 * restarts it; the Chief Technician signs off; Operations confirms; the fix becomes a procedure draft.
 * Screenshots of every step go to screens/line4/.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { cardWithHeading, openFault, showTab, signIn, userId } from "./helpers";

const dir = "screens/line4";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const OPERATOR_WORDS = "I went to Line 4 pump A but could not start it from there. Some alarms refused to reset and the commands could not go through.";
const FOUND = "Latched protection trips on the Bentley Nevada vibration monitor blocked the start; a SCADA reset did not clear them.";
const STEPS: Array<{ action: string; kind: string; result: "Worked" | "Didn't work" | "Partly" }> = [
  { action: "Switched off the VFD breakers at panel 4", kind: "reset", result: "Partly" },
  { action: "LOP panel: held the reset button until it clicked, then switched off the LOP breakers", kind: "reset", result: "Partly" },
  { action: "Reset from SCADA at the local workstation", kind: "reset", result: "Didn't work" },
  { action: "Reset the alarms on the Bentley Nevada HMI", kind: "reset", result: "Worked" },
  { action: "Cleared remaining alarms and hidden commands at the workstation, took the station to local and started pump 401", kind: "reset", result: "Worked" },
  { action: "Handed the station back to the operator", kind: "other", result: "Worked" },
];

async function phone(browser: Browser): Promise<Page> {
  return (await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL })).newPage();
}

const hhmm = (minutesAgo: number) => {
  const moment = new Date(Date.now() - minutesAgo * 60_000);
  return `${String(moment.getHours()).padStart(2, "0")}:${String(moment.getMinutes()).padStart(2, "0")}`;
};

test("Line 4 pump A will not start: report, allocate, write-up, sign-off, confirmation", async ({ page, browser, request }) => {
  test.setTimeout(300_000);

  // 1. Operations, on a phone: reports what they saw.
  const ops = await phone(browser);
  await signIn(ops, "operations");
  await ops.getByRole("navigation", { name: "Quick" }).getByRole("link", { name: "Report", exact: true }).click();
  await ops.getByLabel("1. Which equipment?").fill("line 4 pump a");
  // The pump itself is the best match (not its lube-oil panel or drive).
  await expect(ops.getByText("11-P-401 · Line 4 main pump A (pump 401)", { exact: true })).toBeVisible();
  await ops.getByRole("button", { name: "Yes, this one" }).click();
  await ops.getByRole("group", { name: "Where did you see it" }).getByRole("button", { name: "On a site walk" }).click();
  await ops.getByRole("group", { name: "What is wrong" }).getByRole("button", { name: "Won't start" }).click();
  await ops.getByRole("group", { name: "Start tried from" }).getByRole("button", { name: "Local panel" }).click();
  await ops.getByLabel("Any alarm shown?").fill("Alarms would not reset; start command not accepted");
  await ops.getByRole("group", { name: "Effect on operation" }).getByRole("button", { name: /^Stopped/ }).click();
  await ops.getByRole("group", { name: "Equipment state now" }).getByRole("button", { name: "Stopped" }).click();
  await ops.getByRole("group", { name: "Anyone or anything at risk" }).getByRole("button", { name: /^No$/ }).click();
  await ops.getByRole("group", { name: "Already done" }).getByRole("button", { name: /Called Systems Automation/ }).click();
  await ops.getByLabel(/Anything else/).fill(OPERATOR_WORDS);
  await ops.screenshot({ path: `${dir}/1-operations-report.png`, fullPage: true });
  await ops.getByRole("button", { name: "Submit report" }).click();
  await expect(ops.getByRole("heading", { name: /Reported · KPC-DMO-\d+/ })).toBeVisible();
  await ops.screenshot({ path: `${dir}/2-operations-submitted.png`, fullPage: true });
  await ops.getByRole("link", { name: "Open this report" }).click();
  const faultId = new URL(ops.url()).searchParams.get("fault")!;
  expect(faultId).toBeTruthy();

  // 2. Systems Automation Chief Technician (desk): allocates the job to a PT.
  await signIn(page, "ct-systems-automation");
  await page.screenshot({ path: `${dir}/3-ct-section-oversight.png`, fullPage: true });
  await openFault(page, faultId);
  await page.getByLabel("Assigned technician").selectOption(await userId(request, "pt-systems-automation"));
  await page.getByLabel("Expected response by").fill("2030-01-15T10:00");
  await page.getByRole("button", { name: "Assign work" }).click();
  await expect(page.getByText("Section assignment and response target saved.")).toBeVisible();
  await page.screenshot({ path: `${dir}/4-ct-allocated.png`, fullPage: true });

  // 3. PT, on a phone: takes the job, then writes up the visit from the notebook.
  const pt = await phone(browser);
  await signIn(pt, "pt-systems-automation");
  const jobRow = (section: string) => pt.getByRole("region", { name: section }).locator("article")
    .filter({ has: pt.locator(`a[href="/jobs/${faultId}/card"]`) });
  await pt.screenshot({ path: `${dir}/5-pt-my-jobs.png`, fullPage: true });
  await jobRow("Assigned to you, not visited yet").getByRole("button", { name: "I'm taking this job" }).click();
  await expect(pt.getByText(/You have taken 11-P-401/)).toBeVisible();
  await jobRow("To write up").getByRole("link", { name: "Write up visit" }).click();
  await pt.getByLabel("Arrived on site", { exact: true }).fill(hhmm(0));
  await pt.getByLabel("Back in service", { exact: true }).fill(hhmm(0));
  await pt.getByLabel("What did you find?").fill(FOUND);
  await pt.getByLabel("What kind of cause?").selectOption("trip_latched");
  for (const [index, step] of STEPS.entries()) {
    const number = index + 1;
    if (number > 1) await pt.getByRole("button", { name: "Add another thing you did" }).click();
    await pt.getByLabel(`Step ${number}: what you did`).fill(step.action);
    await pt.getByRole("group", { name: `Step ${number}: did it work?` }).getByRole("button", { name: step.result }).click();
    await pt.getByLabel(`Step ${number}: kind of action`).selectOption(step.kind);
  }
  await pt.getByRole("group", { name: "Differs from the drawing" }).getByRole("button", { name: "No" }).click();
  await pt.screenshot({ path: `${dir}/6-pt-write-up.png`, fullPage: true });
  await pt.getByRole("button", { name: "Save and ask Chief to sign off" }).click();
  await expect(pt.getByRole("heading", { name: "Sent to your Chief Technician for sign-off" })).toBeVisible();
  await pt.screenshot({ path: `${dir}/7-pt-sent-for-sign-off.png`, fullPage: true });

  // 4. Chief Technician (desk): sees every step, including what did not work, and signs off.
  await signIn(page, "ct-systems-automation");
  await openFault(page, faultId);
  await showTab(page, "History");
  const log = cardWithHeading(page, "Checks and fixes tried");
  await expect(log.getByText("FAILED intervention")).toBeVisible();
  await page.screenshot({ path: `${dir}/8-ct-review.png`, fullPage: true });
  // The next step takes the Chief Technician straight to the sign-off.
  await page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Review and sign off" }).click();
  await page.getByRole("button", { name: "Approve technical completion" }).click();
  await expect(page.getByText("Chief technical review approved.")).toBeVisible();

  // 5. Operations, on a phone: confirms the pump is running and closes it.
  await openFault(ops, faultId);
  await ops.screenshot({ path: `${dir}/9-operations-confirm.png`, fullPage: true });
  await ops.getByRole("button", { name: "Yes, it works: close it" }).click();
  await expect(ops.getByText("Operational restoration confirmed")).toBeVisible();

  // 6. The PT's fix becomes a procedure draft (the exact sequence, including the step that did not work).
  await pt.goto("/dashboard");
  await pt.getByRole("region", { name: "Turn your fix into a procedure" }).locator(`a[href="/jobs/${faultId}/procedure"]`).click();
  await expect(pt.getByLabel(/Don't bother with/)).toHaveValue(/Reset from SCADA at the local workstation/);
  // The fix is the whole sequence that got it running, in order (not just the last step).
  await expect(pt.getByLabel(/^Fix/)).toHaveValue(/^1\. Switched off the VFD breakers at panel 4\n2\. LOP panel: .*\n3\. Reset the alarms on the Bentley Nevada HMI\n4\. Cleared .*started pump 401\n5\. Handed the station back to the operator$/);
  await pt.screenshot({ path: `${dir}/10-pt-procedure-draft.png`, fullPage: true });

  // 7. What the Senior Engineer and Chief Engineer of the section see (no step for them in a routine fix).
  for (const [name, username] of [["11-se-home", "senior-engineer-systems-automation"], ["12-ce-home", "chief-engineer-systems-automation"]]) {
    const viewer = await phone(browser);
    await signIn(viewer, username);
    await viewer.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await viewer.context().close();
  }
});
