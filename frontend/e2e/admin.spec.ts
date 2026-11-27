/**
 * Admin console: the System Administrator (ICT) and the developer / owner. Health, rules, the
 * equipment register, the audit trail, and the developer's read-only "view as".
 * Screenshots go to screens/admin/.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const dir = "screens/admin";

test("the System Administrator runs the system but has no developer tools", async ({ page }) => {
  await signIn(page, "admin");
  await expect(page.getByRole("region", { name: "Admin console" }).getByRole("link", { name: /Health/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Developer tools/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin console" }).click();
  await expect(page.getByRole("tabpanel", { name: "Health" }).getByText("Database", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Developer tools" })).toHaveCount(0);
});

test("the developer checks health, changes a rule, adds equipment and views as a technician", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "developer");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  await page.screenshot({ path: `${dir}/1-admin-home.png`, fullPage: true });

  await page.goto("/admin?tab=health");
  await expect(page.getByRole("tabpanel", { name: "Health" }).getByText("Background timer", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${dir}/2-health.png`, fullPage: true });

  // A rule: change it, see it saved and audited, then put it back.
  await page.getByRole("tab", { name: "Rules" }).click();
  const field = page.getByLabel("Show untaken jobs to other sections and the Chief Technician after (minutes)");
  await field.fill("20");
  await field.locator("xpath=ancestor::form").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. It applies straight away.")).toBeVisible();
  await page.screenshot({ path: `${dir}/3-rules.png`, fullPage: true });
  await page.getByLabel("Show untaken jobs to other sections and the Chief Technician after (minutes)")
    .locator("xpath=ancestor::form").getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByText("Back to the default.")).toBeVisible();

  // Demo equipment, by hand.
  const tag = `DEMO-P-${Date.now().toString().slice(-6)}`;
  await page.getByRole("tab", { name: "Equipment register" }).click();
  await page.getByRole("button", { name: "Add equipment" }).click();
  const form = page.getByRole("form", { name: "Add equipment" });
  await form.getByLabel("Tag", { exact: true }).fill(tag);
  await form.getByLabel("Name", { exact: true }).fill("Demo booster pump for the board");
  await form.getByLabel("Station", { exact: true }).fill("PS02");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(`${tag} added. Operations can report on it now.`)).toBeVisible();
  await page.getByLabel("Search the register").fill(tag);
  await expect(page.getByRole("cell", { name: tag, exact: true })).toBeVisible();
  await page.screenshot({ path: `${dir}/4-equipment.png`, fullPage: true });

  await page.getByRole("tab", { name: "Audit trail" }).click();
  const trail = page.getByRole("table", { name: "Audit trail" });
  await expect(trail.getByText("Rule changed").first()).toBeVisible();
  await expect(trail.getByText("Equipment added").first()).toBeVisible();
  await page.screenshot({ path: `${dir}/5-audit.png`, fullPage: true });

  // View as a technician: their screens, read-only, then back.
  await page.getByRole("tab", { name: "Developer tools" }).click();
  const person = page.getByLabel("Person");
  await expect(person.locator("option", { hasText: "Senior Technician (ST) (Electrical, Nairobi)" })).toBeAttached();
  const options = await person.locator("option").allTextContents();
  await person.selectOption({ label: options.find((text) => text.includes("Senior Technician (ST) (Electrical, Nairobi)"))! });
  await page.screenshot({ path: `${dir}/6-developer-tools.png`, fullPage: true });
  await page.getByRole("button", { name: "View as this person" }).click();
  const bar = page.getByRole("status", { name: "Viewing as" });
  await expect(bar).toContainText("Viewing as Demo Senior Technician (ST) (Electrical, Nairobi)");
  await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
  await page.screenshot({ path: `${dir}/7-viewing-as.png` });
  await bar.getByRole("button", { name: "Back to my account" }).click();
  await expect(page.getByRole("tab", { name: "Developer tools", selected: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Viewing as" })).toHaveCount(0);
});
