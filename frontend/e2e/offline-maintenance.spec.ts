/**
 * Scenario 4 — Offline maintenance (MASTER BUILD PROMPT §16).
 * Changes are made without a server connection, survive closing and reopening
 * the app, and reach the backend exactly once after reconnection.
 */
import { expect, test } from "@playwright/test";
import {
  apiGet, apiPost, apiToken, setSimulatedNetwork, signIn, waitForOfflineVerifier, waitForSyncedOutbox,
} from "./helpers";

type FaultRow = { id: string; reference: string; symptom: string; equipment_tag: string };
type TimelineRow = { event_type: string; payload: string | Record<string, unknown> };

test("Operations reports a breakdown offline; it survives a restart and offline sign-in, then syncs once", async ({ page, request }) => {
  // A description that matches no registered equipment, so it goes for identification.
  const description = `E2E offline drain line ${Date.now()}`;
  await signIn(page, "operations");
  await waitForOfflineVerifier(page, "operations");

  await page.goto("/report");
  await setSimulatedNetwork(page, "offline");
  await expect(page.getByRole("status").first()).toContainText("Offline (simulated)");

  await page.getByLabel("1. Which equipment?").fill(description);
  await page.getByRole("group", { name: "What is wrong" }).getByRole("button", { name: "Leaking" }).click();
  await page.getByRole("group", { name: "Effect on operation" }).getByRole("button", { name: /Running reduced/ }).click();
  await page.getByRole("group", { name: "Anyone or anything at risk" }).getByRole("button", { name: /^No$/ }).click();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByRole("heading", { name: "Saved on this computer" })).toBeVisible();
  await expect(page.getByLabel("Changes waiting")).toHaveText("1");

  // Close and reopen the application while still offline.
  await page.close();
  const reopened = await page.context().newPage();
  await reopened.goto("/faults?mode=history");
  await expect(reopened.getByText(description).first()).toBeVisible();
  await expect(reopened.getByText("Pending sync").first()).toBeVisible();

  // Sign out and back in with no connection.
  await reopened.getByRole("button", { name: "Log out" }).click();
  await signIn(reopened, "operations");
  await expect(reopened.getByText("Offline sign-in")).toBeVisible();
  await expect(reopened.getByLabel("Changes waiting")).toHaveText("1");

  // Reconnect: the app synchronises on start without user action.
  await setSimulatedNetwork(reopened, "online");
  await waitForSyncedOutbox(reopened);

  const token = await apiToken(request, "operations");
  const matches = await apiGet<FaultRow[]>(request, token, `/api/v1/faults?search=${encodeURIComponent(description)}`);
  expect(matches.filter((row) => row.equipment_tag === description)).toHaveLength(1);
  expect(matches[0].reference).toMatch(/^KPC-DMO-/);
  expect(matches[0].symptom).toBe("Leaking");
});

test("The installed app opens and navigates with no network at all", async ({ page, context }) => {
  await signIn(page, "automation");
  const controlled = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    for (let attempt = 0; attempt < 20 && !navigator.serviceWorker.controller; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return Boolean(navigator.serviceWorker.controller);
  });
  test.skip(!controlled, "The service worker only runs on a production build (vite preview / Docker)");

  // Load the data this user needs while connected, then lose the network completely.
  await page.goto("/faults?mode=history");
  await expect(page.getByRole("heading", { name: "Breakdowns" })).toBeVisible();
  await page.goto("/equipment");
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
  await context.setOffline(true);

  // Cold reload: the shell and route chunks come from the precache, data from IndexedDB.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
  await expect(page.getByText("Offline: showing equipment cached on this device")).toBeVisible();
  await page.goto("/faults?mode=history");
  await expect(page.getByRole("heading", { name: "Breakdowns" })).toBeVisible();
  await expect(page.getByText("Offline: showing breakdowns cached on this device", { exact: false })).toBeVisible();
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "Approved procedures and knowledge" })).toBeVisible();
  await context.setOffline(false);
});

test("Systems Automation investigates offline; every step syncs exactly once with device timestamps", async ({ page, request, context }) => {
  const operations = await apiToken(request, "operations");
  const equipment = await apiGet<Array<{ id: string; section: string }>>(request, operations, "/api/v1/equipment");
  const symptom = `E2E offline investigation ${Date.now()}`;
  const fault = await apiPost<FaultRow>(request, operations, "/api/v1/faults", {
    equipment_id: equipment.find((item) => item.section === "Electrical")!.id,
    symptom,
    operational_impact: "Valve unavailable (synthetic)",
  });

  await signIn(page, "automation");
  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  await expect(page.getByRole("button", { name: "Acknowledge" })).toBeVisible(); // investigation cached

  // Real browser disconnection (not the simulator).
  await context.setOffline(true);
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("saved on this device", { exact: false }).first()).toBeVisible();

  const diagnosisForm = page.locator("form", { hasText: "Record possible cause and checks" });
  await diagnosisForm.getByLabel("Possible cause").fill("Loose actuator supply terminal");
  await diagnosisForm.getByLabel("Diagnostic method").fill("Continuity test at the junction box");
  await diagnosisForm.getByRole("button", { name: "Save diagnosis" }).click();
  await expect(page.getByText("Diagnosis: No connection", { exact: false })).toBeVisible();

  const interventionForm = page.locator("form", { hasText: "Record each intervention" });
  await interventionForm.getByLabel("Action taken").fill("Reseated the connector");
  await interventionForm.getByLabel("Outcome").selectOption("FAILED");
  await interventionForm.getByRole("button", { name: "Save intervention" }).click();
  await expect(page.getByText("Intervention: No connection", { exact: false })).toBeVisible();
  await interventionForm.getByLabel("Action taken").fill("Replaced the terminal block");
  await interventionForm.getByLabel("Outcome").selectOption("SUCCESS");
  await interventionForm.getByRole("button", { name: "Save intervention" }).click();
  await expect(page.getByLabel("Changes waiting")).toHaveText("4");

  // Reopen the app while the API is still unreachable: the queued work is still there.
  await context.setOffline(false);
  await setSimulatedNetwork(page, "offline");
  await expect(page.getByText("this is the copy saved on this device", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Changes waiting")).toHaveText("4");

  await setSimulatedNetwork(page, "online");
  await waitForSyncedOutbox(page);

  const automation = await apiToken(request, "automation");
  const timeline = await apiGet<TimelineRow[]>(request, automation, `/api/v1/faults/${fault.id}/timeline`);
  const count = (type: string) => timeline.filter((row) => row.event_type === type).length;
  expect(count("FAULT_ACKNOWLEDGE")).toBe(1);
  expect(count("DIAGNOSIS_RECORDED")).toBe(1);
  expect(count("INTERVENTION_FAILED")).toBe(1);
  expect(count("INTERVENTION_SUCCESS")).toBe(1);
  const diagnosisEvent = timeline.find((row) => row.event_type === "DIAGNOSIS_RECORDED")!;
  const payload = typeof diagnosisEvent.payload === "string" ? JSON.parse(diagnosisEvent.payload) : diagnosisEvent.payload;
  expect(payload.offline.device_id).toMatch(/^DEVICE-/);
  expect(payload.offline.client_timestamp).toBeTruthy();
});
