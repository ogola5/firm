/**
 * Scenario 5 — Concurrent edits (MASTER BUILD PROMPT §16).
 * Two people act on the same breakdown while one of them is disconnected. On
 * reconnection the conflict is detected, nothing is silently overwritten, and
 * an authorised person reconciles it with a recorded reason.
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiPost, apiToken, equipmentIn, openFault, setSimulatedNetwork, signIn, userId } from "./helpers";

test("Scenario 5: a stale offline change is held for reconciliation, not applied", async ({ page, request }) => {
  test.setTimeout(180_000);
  const operations = await apiToken(request, "operations");
  const equipment = await equipmentIn(request, "Instrumentation");
  const symptom = `E2E concurrent edit ${Date.now()}`;
  const fault = await apiPost<{ id: string }>(request, operations, "/api/v1/faults", {
    equipment_id: equipment.id, equipment_confirmed: true, symptom, operational_impact: "Reading unstable (synthetic)",
  });

  // Systems Automation opens the breakdown while connected, then loses the network.
  await signIn(page, "automation");
  await openFault(page, fault.id);
  await setSimulatedNetwork(page, "offline");
  await expect(page.getByText("this is the copy saved on this device", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("saved on this device and queued", { exact: false })).toBeVisible();

  // Meanwhile a supervisor takes the same breakdown online.
  const supervisor = await apiToken(request, "supervisor");
  await apiPost(request, supervisor, `/api/v1/faults/${fault.id}/action?action=acknowledge`, {});

  // Reconnect: the queued change reaches the server and is held as a conflict.
  await setSimulatedNetwork(page, "online");
  await page.goto("/sync");
  // The conflict is listed against this breakdown (other conflicts may also be open).
  const conflict = page.getByRole("group").filter({ hasText: symptom });
  await expect(conflict.getByText("while this device was offline", { exact: false })).toBeVisible({ timeout: 60_000 });

  // Nothing was overwritten: the supervisor still owns the job.
  const current = await apiGet<{ assigned_user_id: string }>(request, supervisor, `/api/v1/faults/${fault.id}`);
  expect(current.assigned_user_id).toBe(await userId(request, "supervisor"));

  // Applying is refused by the workflow rules; discarding needs a reason and is recorded.
  await conflict.getByRole("button", { name: "Apply to current record" }).click();
  await expect(page.getByText("The change still cannot be applied", { exact: false })).toBeVisible();
  await conflict.getByLabel("Reason for decision").fill("Supervisor already took this breakdown");
  await conflict.getByRole("button", { name: "Discard offline change" }).click();
  await expect(page.getByText("The offline change was discarded and the decision recorded.")).toBeVisible();

  const timeline = await apiGet<Array<{ event_type: string }>>(request, supervisor, `/api/v1/faults/${fault.id}/timeline`);
  expect(timeline.filter((item) => item.event_type === "SYNC_CONFLICT_RESOLVED")).toHaveLength(1);
  expect(timeline.filter((item) => item.event_type === "FAULT_ACKNOWLEDGE")).toHaveLength(1);
});
