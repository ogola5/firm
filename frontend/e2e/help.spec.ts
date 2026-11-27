/**
 * Finding your way without help: the first-visit welcome, the "?" hints, the shorter menu with
 * descriptions, the simpler Chief Technician page and the quick guide. Screenshots go to screens/help/.
 */
import { expect, test } from "@playwright/test";
import { menuLink, signIn } from "./helpers";

const dir = "screens/help";

test("a technician is welcomed, can read what a term means, and finds the quick guide", async ({ page }) => {
  await signIn(page, "pt-electrical");
  await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("kpc-welcome-dismissed")).forEach((key) => localStorage.removeItem(key)));
  await page.reload();
  const welcome = page.getByRole("region", { name: "Welcome" });
  await expect(welcome).toContainText("Anyone free can take a new job");
  await page.getByRole("button", { name: "What is Needs you now?" }).click();
  await expect(page.getByRole("note").filter({ hasText: "most urgent first" })).toBeVisible();
  await page.screenshot({ path: `${dir}/1-welcome-and-hint.png` });

  // The menu: daily items with a line on what each is for; the rest under More.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByText("What worked, by type of equipment")).toBeVisible();
  await (await menuLink(page, "Likely to fail")).click();
  await expect(page.getByRole("heading", { name: "Likely to fail" })).toBeVisible();

  await page.goto("/dashboard");
  await welcome.getByRole("button", { name: "Got it, hide this" }).click();
  await expect(welcome).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Welcome" })).toHaveCount(0); // stays hidden

  await page.getByRole("link", { name: "Quick guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quick guide" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Write up the visit" })).toBeVisible();
  await page.screenshot({ path: `${dir}/2-quick-guide.png`, fullPage: true });
});

test("the Chief Technician's page leads with what needs them and three numbers", async ({ page }) => {
  await signIn(page, "ct-mechanical");
  const today = page.getByRole("region", { name: "Your section today" });
  await expect(today.getByText("Not taken yet")).toBeVisible();
  await expect(today.getByText("Being worked on")).toBeVisible();
  await expect(page.getByLabel("Fault responsibility flow")).toBeHidden(); // folded under "More about your section"
  await page.screenshot({ path: `${dir}/3-chief-technician.png`, fullPage: true });
});
