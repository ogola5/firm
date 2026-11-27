import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const PASSWORD = "demo123"; // synthetic demo credential

/** Seeded demonstration accounts are demo.<name>@kpc.co.ke. */
export const demoEmail = (username: string) => `demo.${username}@kpc.co.ke`;

export async function apiToken(request: APIRequestContext, username: string): Promise<string> {
  const response = await request.post("/api/v1/auth/login", { data: { email: demoEmail(username), password: PASSWORD } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token;
}

export async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const response = await request.get(path, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok(), `${path} -> ${response.status()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

export async function apiPost<T>(request: APIRequestContext, token: string, path: string, data: unknown): Promise<T> {
  const response = await request.post(path, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${path} -> ${response.status()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

export type Row = Record<string, unknown>;

export const sectionSlug = (section: string) => section.toLowerCase().replace(/ /g, "-");

export async function userId(request: APIRequestContext, username: string): Promise<string> {
  const token = await apiToken(request, username);
  return (await apiGet<{ id: string }>(request, token, "/api/v1/auth/me")).id;
}

export async function equipmentIn(request: APIRequestContext, section: string): Promise<Row> {
  const token = await apiToken(request, "operations");
  const rows = await apiGet<Row[]>(request, token, "/api/v1/equipment");
  // The seeded section teams (ct-<section>, st-<section>, ...) work in the Nairobi region.
  return rows.find((row) => row.section === section && row.region === "Nairobi" && !String(row.tag).startsWith("UNCONFIRMED"))!;
}

/**
 * Drives a breakdown through the whole workflow via the API (fast setup for scenarios that start
 * from a closed fault): straight to the section, taken by a technician, working again, confirmed by
 * Operations, and the write-up checked by the Chief Technician.
 */
export async function closedFaultViaApi(
  request: APIRequestContext,
  { section, technician, symptom }: { section: string; technician: string; symptom: string },
): Promise<{ faultId: string; equipment: Row }> {
  const operations = await apiToken(request, "operations");
  const chief = await apiToken(request, `ct-${sectionSlug(section)}`);
  const tech = await apiToken(request, technician);
  const equipment = await equipmentIn(request, section);
  const fault = await apiPost<{ id: string }>(request, operations, "/api/v1/faults", {
    equipment_id: equipment.id, equipment_confirmed: true, symptom, operational_impact: "Synthetic test impact", send_to: section,
  });
  await apiPost(request, tech, `/api/v1/faults/${fault.id}/action?action=acknowledge`, {});
  const diagnosis = await apiPost<{ id: string }>(request, tech, `/api/v1/faults/${fault.id}/diagnoses`, {
    possible_cause: "Worn seal (synthetic)", diagnostic_method: "Visual inspection",
  });
  await apiPost(request, tech, `/api/v1/faults/${fault.id}/interventions`, {
    diagnosis_id: diagnosis.id, corrective_action: "Replaced the seal", outcome: "SUCCESS",
  });
  await apiPost(request, tech, `/api/v1/faults/${fault.id}/action?action=restore`, {});
  await apiPost(request, operations, `/api/v1/faults/${fault.id}/operator-confirmation`, { confirmed: true, comments: "Service restored (synthetic)." });
  const context = await apiGet<{ assignments: Row[] }>(request, chief, `/api/v1/faults/${fault.id}/context`);
  const toCheck = String(context.assignments.find((item) => item.completion_review_status === "PENDING")!.id);
  await apiPost(request, chief, `/api/v1/faults/${fault.id}/assignments/${toCheck}/review`, { decision: "APPROVE_COMPLETION" });
  return { faultId: fault.id, equipment };
}

/** On a job already, new breakdowns are folded under "Other breakdowns waiting": open it when it is there. */
export async function showOtherBreakdowns(page: Page) {
  await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
  const fold = page.getByText(/^Other breakdowns waiting/);
  // Wait for the job lists to load: either the fold or the open list is there.
  await expect(fold.or(page.getByRole("region", { name: "New: nobody has taken it yet" }))).toBeVisible();
  if (await fold.isVisible()) await fold.click();
}

/** Sets an admin-console rule for a test (developer account), returning a function that puts it back. */
export async function withRule(request: APIRequestContext, key: string, value: unknown): Promise<() => Promise<void>> {
  const token = await apiToken(request, "developer");
  const patch = (body: unknown) => request.patch(`/api/v1/admin/settings/${key}`, { headers: { Authorization: `Bearer ${token}` }, data: body });
  expect((await patch({ value })).ok()).toBeTruthy();
  return async () => { await patch({ reset: true }); };
}

/** A link in the side menu; the less-used ones are folded under "More". */
export async function menuLink(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Main" });
  const link = nav.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) await nav.getByText("More", { exact: true }).click();
  return link;
}

export async function openFault(page: Page, faultId: string) {
  await page.goto(`/faults?mode=history&fault=${encodeURIComponent(faultId)}`);
  await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
}

/** The fault page has three tabs: Now (default), What we know, History. */
export async function showTab(page: Page, name: "Now" | "What we know" | "History") {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("tabpanel", { name })).toBeVisible();
}

/** The card (Card root) that contains a heading with this exact text. */
export function cardWithHeading(page: Page, heading: string) {
  return page.locator("div.rounded-lg").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).last();
}

/** Signs in through the UI (online, or offline when the simulator blocks the API). */
export async function signIn(page: Page, username: string) {
  await page.goto("/");
  // Switching user: sign the current one out first (offline data on the device is kept).
  const emailField = page.getByLabel("KPC email");
  const signedIn = page.getByRole("button", { name: /Sync now/ });
  await expect(emailField.or(signedIn)).toBeVisible();
  if (await signedIn.isVisible()) await signOut(page);
  await expect(emailField).toBeVisible();
  // Typed, like a person would (the demonstration list needs the server; offline it never arrives).
  await emailField.fill(demoEmail(username));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(signedIn).toBeVisible();
}

/** Log out from the side menu (on a phone, open the menu first). */
export async function signOut(page: Page) {
  const logout = page.getByRole("button", { name: "Log out" });
  if (!(await logout.isVisible())) await page.getByRole("button", { name: /Open menu|More/ }).first().click();
  await logout.click();
}

/** Switches the demonstration network simulator (persists across reloads, like a real outage). */
export async function setSimulatedNetwork(page: Page, mode: "online" | "offline" | "intermittent") {
  await page.evaluate((value) => localStorage.setItem("kpc-network-mode", value), mode);
  await page.reload();
}

export async function waitForSyncedOutbox(page: Page) {
  await expect(page.getByLabel("Changes waiting")).toHaveText("0", { timeout: 60_000 });
}

/** The PBKDF2 verifier for offline sign-in is written in the background after login. */
export async function waitForOfflineVerifier(page: Page, username: string) {
  await expect.poll(() => page.evaluate((name) => new Promise<boolean>((resolve) => {
    const open = indexedDB.open("kpcMaintenance");
    open.onsuccess = () => {
      const request = open.result.transaction("offlineSessions").objectStore("offlineSessions").get(name);
      request.onsuccess = () => resolve(Boolean(request.result));
      request.onerror = () => resolve(false);
    };
    open.onerror = () => resolve(false);
  }), demoEmail(username))).toBe(true);
}
