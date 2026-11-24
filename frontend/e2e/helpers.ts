import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const PASSWORD = "demo123"; // synthetic demo credential

export async function apiToken(request: APIRequestContext, username: string): Promise<string> {
  const response = await request.post("/api/v1/auth/login", { data: { username, password: PASSWORD } });
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

/** Signs in through the UI (online, or offline when the simulator blocks the API). */
export async function signIn(page: Page, username: string) {
  await page.goto("/");
  const accountSelect = page.locator("select").first();
  await expect(accountSelect).toBeVisible();
  // The account list loads from the server; offline it never arrives, so type the username.
  const option = accountSelect.locator(`option[value="${username}"]`);
  const listed = await option.waitFor({ state: "attached", timeout: 5_000 }).then(() => true, () => false);
  if (listed) {
    await accountSelect.selectOption(username);
  } else {
    await accountSelect.selectOption("");
    await page.getByLabel("Username", { exact: true }).fill(username);
  }
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
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
  }), username)).toBe(true);
}
