/**
 * Pillar C and B, as people meet them: a fault on Line 4 pump A shows the system it belongs to and what
 * its drive and panels have been doing; the legacy system page says how the parts connect and what has
 * been changed; similar faults are still ranked on the phone with no network.
 * Screenshots go to screens/systems/.
 */
import { expect, test } from "@playwright/test";
import { apiGet, apiPost, apiToken, showTab, signIn, type Row } from "./helpers";

const dir = "screens/systems";

async function reportOn(request: Parameters<typeof apiToken>[0], tag: string, symptom: string, description: string) {
  const operations = await apiToken(request, "operations");
  const asset = (await apiGet<Row[]>(request, operations, `/api/v1/equipment?search=${tag}`)).find((row) => row.tag === tag)!;
  return apiPost<{ id: string; reference: string }>(request, operations, "/api/v1/faults", {
    equipment_id: asset.id, symptom, description, operational_impact: "Stopped: Operation stopped or at risk",
  });
}

test("a fault shows its system and related equipment; the legacy system page holds how it connects and what changed", async ({ page, request }) => {
  const fault = await reportOn(request, "11-P-401", "Won't start", "Pump 401 refuses to start, alarms will not reset");
  await signIn(page, "automation");
  await page.goto(`/faults?mode=history&fault=${fault.id}`);
  await showTab(page, "What we know");
  const related = page.getByLabel("Related equipment");
  await expect(related.getByRole("link", { name: "Line 4 pump A unit" })).toBeVisible();
  await expect(related.getByText("Legacy system")).toBeVisible();
  // What the equipment it works with has been doing (the pump's own history outranks these in "Similar earlier faults").
  await expect(related.getByText(/· 11-(VFD|LOP|VMS|RTU)-401 ·/).first()).toBeVisible();
  await page.screenshot({ path: `${dir}/1-fault-related.png`, fullPage: true });

  await related.getByRole("link", { name: "Line 4 pump A unit" }).click();
  await expect(page.getByRole("heading", { name: "Line 4 pump A unit" })).toBeVisible();
  await expect(page.getByLabel("How it connects").getByText(/run-permit/)).toBeVisible();
  const changes = page.getByLabel("Changes over the years");
  // Unique per run, so repeated runs against the same database do not collide.
  const change = `Drive panel 4 cooling fan replaced with a higher-flow model (${Date.now()})`;
  await changes.getByLabel("Record a change").fill(change);
  await changes.getByRole("button", { name: "Record change" }).click();
  await expect(page.getByText("Change recorded. The next person will know.")).toBeVisible();
  await expect(changes.getByText(change)).toBeVisible();
  await page.screenshot({ path: `${dir}/2-system-page.png`, fullPage: true });
});

test("similar faults are ranked on the device when there is no network", async ({ page, context, request }) => {
  const fault = await reportOn(request, "11-VFD-401", "Stopped / tripped", "VFD hot trip again this afternoon");
  await signIn(page, "automation");
  const controlled = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    for (let attempt = 0; attempt < 20 && !navigator.serviceWorker.controller; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
    return Boolean(navigator.serviceWorker.controller);
  });
  test.skip(!controlled, "The service worker only runs on a production build (vite preview / Docker)");

  // While connected: open the fault once (its details and the case index are saved on the device).
  await page.goto(`/faults?mode=history&fault=${fault.id}&tab=know`);
  await expect(page.getByLabel("Similar earlier faults").getByText(/Similar problem description|Same problem described/).first()).toBeVisible();
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.reload();
  const similar = page.getByLabel("Similar earlier faults");
  await expect(similar.getByText(/Offline: ranked on this phone from the copy saved/)).toBeVisible();
  await expect(similar.getByText(/Similar problem description|Same problem described/).first()).toBeVisible();
  await page.screenshot({ path: `${dir}/3-similar-offline.png`, fullPage: true });
  await context.setOffline(false);
});
