/**
 * Real case, end to end, as each person would do it (phones for Operations and the technician):
 * Operations cannot start Line 4 pump A and sends it straight to Systems Automation; a PT who is free
 * takes it, clears the latched trips and restarts it; Operations confirms at once; the Chief Technician
 * checks the write-up afterwards; the fix becomes a procedure draft. Screenshots go to screens/line4/.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { cardWithHeading, openFault, showTab, signIn } from "./helpers";

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

test("Line 4 pump A will not start: report, anyone free takes it, write-up, confirmation, write-up check", async ({ page, browser }) => {
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
  // The pump is Mechanical's, but alarms that will not reset are a control problem: send it to Systems Automation.
  await ops.getByRole("group", { name: "Who should come" }).getByRole("button", { name: /^Systems Automation/ }).click();
  await ops.screenshot({ path: `${dir}/1-operations-report.png`, fullPage: true });
  await ops.getByRole("button", { name: "Submit report" }).click();
  await expect(ops.getByRole("heading", { name: /Reported · KPC-DMO-\d+/ })).toBeVisible();
  await expect(ops.locator("p", { hasText: "Who has it now:" })).toContainText("Systems Automation");
  await ops.screenshot({ path: `${dir}/2-operations-submitted.png`, fullPage: true });
  await ops.getByRole("link", { name: "Open this report" }).click();
  const faultId = new URL(ops.url()).searchParams.get("fault")!;
  expect(faultId).toBeTruthy();

  // 2. A Systems Automation PT who is free, on a phone: takes it straight away (no allocation), then
  //    writes up the visit from the notebook.
  const pt = await phone(browser);
  await signIn(pt, "pt-systems-automation");
  const jobRow = (section: string) => pt.getByRole("region", { name: section }).locator("article")
    .filter({ has: pt.locator(`a[href="/jobs/${faultId}/card"]`) });
  await pt.screenshot({ path: `${dir}/3-pt-my-jobs.png`, fullPage: true });
  await jobRow("New: nobody has taken it yet").getByRole("button", { name: "Take this job" }).click();
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
  await pt.getByRole("button", { name: "Save: it's working again" }).click();
  await expect(pt.getByRole("heading", { name: "Working again: Operations will confirm" })).toBeVisible();
  await pt.screenshot({ path: `${dir}/4-pt-working-again.png`, fullPage: true });

  // 3. Operations, on a phone: confirms the pump is running and closes it, without waiting for a sign-off.
  await openFault(ops, faultId);
  await ops.screenshot({ path: `${dir}/5-operations-confirm.png`, fullPage: true });
  await ops.getByRole("button", { name: "Yes, it works: close it" }).click();
  await expect(ops.getByText("Operational restoration confirmed")).toBeVisible();

  // 4. Chief Technician (desk), afterwards: sees who took it and every step, including what did not work,
  //    and checks the write-up.
  await signIn(page, "ct-systems-automation");
  await page.screenshot({ path: `${dir}/6-ct-section-oversight.png`, fullPage: true });
  await openFault(page, faultId);
  await showTab(page, "History");
  const log = cardWithHeading(page, "Checks and fixes tried");
  await expect(log.getByText("FAILED intervention")).toBeVisible();
  await page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Check the write-up" }).click();
  await page.screenshot({ path: `${dir}/7-ct-checks-write-up.png`, fullPage: true });
  await page.getByRole("button", { name: "Write-up is good" }).click();
  await expect(page.getByText("Write-up approved.")).toBeVisible();

  // 5. The PT's fix becomes a procedure draft (the exact sequence, including the step that did not work).
  await pt.goto("/dashboard");
  await pt.getByRole("region", { name: "Turn your fix into a procedure" }).locator(`a[href="/jobs/${faultId}/procedure"]`).click();
  await expect(pt.getByLabel(/Don't bother with/)).toHaveValue(/Reset from SCADA at the local workstation/);
  // The fix is the whole sequence that got it running, in order (not just the last step).
  await expect(pt.getByLabel(/^Fix/)).toHaveValue(/^1\. Switched off the VFD breakers at panel 4\n2\. LOP panel: .*\n3\. Reset the alarms on the Bentley Nevada HMI\n4\. Cleared .*started pump 401\n5\. Handed the station back to the operator$/);
  await pt.screenshot({ path: `${dir}/8-pt-procedure-draft.png`, fullPage: true });

  // 6. What the Senior Engineer and Chief Engineer of the section see (no step for them in a routine fix).
  for (const [name, username] of [["9-se-home", "senior-engineer-systems-automation"], ["10-ce-home", "chief-engineer-systems-automation"]]) {
    const viewer = await phone(browser);
    await signIn(viewer, username);
    await viewer.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await viewer.context().close();
  }
});
