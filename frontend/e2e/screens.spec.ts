/**
 * Visual capture of the main screens per role (not assertions).
 * Run: SCREENS_DIR=before npx playwright test screens --grep @screens
 */
import { test } from "@playwright/test";
import { signIn } from "./helpers";

const dir = `screens/${process.env.SCREENS_DIR ?? "current"}`;

test("@screens desk workflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "operations");
  await page.goto("/report");
  await page.getByLabel("1. Which equipment?").fill("tank 601 inlet valve");
  await page.getByRole("button", { name: "Yes, this one" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/desk-report.png`, fullPage: true });

  await signIn(page, "st-electrical");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/desk-my-jobs.png`, fullPage: true });
  const writeUp = page.getByRole("link", { name: "Write up visit" }).first();
  if (await writeUp.count()) {
    await writeUp.click();
    await page.getByLabel("What did you find?").waitFor();
    await page.screenshot({ path: `${dir}/desk-write-up.png`, fullPage: true });
    await page.goBack();
    await page.getByRole("link", { name: "Print job card" }).first().click();
    await page.getByRole("article", { name: "Job card" }).waitFor();
    await page.screenshot({ path: `${dir}/desk-job-card.png`, fullPage: true });
  }
});

const shots: Array<{ user: string; pages: Array<[string, string]> }> = [
  { user: "operations", pages: [["dashboard", "/dashboard"], ["report", "/faults?mode=report"], ["faults", "/faults?mode=history"]] },
  { user: "automation", pages: [["work", "/dashboard"], ["equipment", "/equipment"], ["knowledge", "/knowledge"], ["sync", "/sync"]] },
  { user: "ct-electrical", pages: [["oversight", "/dashboard"], ["review", "/approvals"], ["drawings", "/drawings"]] },
  { user: "maintenance-manager", pages: [["dashboard", "/dashboard"], ["analytics", "/analytics"]] },
  { user: "ceo", pages: [["home", "/dashboard"], ["analytics", "/analytics"]] },
  { user: "chief-engineer-electrical", pages: [["home", "/dashboard"]] },
  { user: "st-instrumentation", pages: [["home", "/dashboard"], ["watch", "/watch"], ["expertise", "/expertise?tab=sessions"]] },
  { user: "hr", pages: [["recognition", "/recognition"], ["at-risk", "/expertise"]] },
  { user: "admin", pages: [["home", "/dashboard"], ["people", "/people"]] },
];

for (const { user, pages } of shots) {
  test(`@screens ${user}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, user);
    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/${user}-${name}.png`, fullPage: true });
    }
  });
}

test("@screens printed reports", async ({ page }) => {
  await signIn(page, "maintenance-manager");
  for (const kind of ["week", "year"]) {
    await page.goto(`/reports?kind=${kind}`);
    await page.getByRole("article", { name: "Report" }).getByRole("heading", { name: "Trend" }).waitFor();
    await page.waitForTimeout(500);
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: `${dir}/report-${kind}.pdf`, format: "A4", printBackground: true });
    await page.emulateMedia({ media: "screen" });
  }
});

test("@screens login", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/login.png` });
});
