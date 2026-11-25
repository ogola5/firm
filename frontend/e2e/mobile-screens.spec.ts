/**
 * Phone-sized captures of the main screens per role (not assertions).
 * Run: SCREENS_DIR=mobile-before npx playwright test mobile-screens --grep @mobile
 */
import { test } from "@playwright/test";
import { signIn } from "./helpers";

const dir = `screens/${process.env.SCREENS_DIR ?? "mobile"}`;
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const shots: Array<{ user: string; pages: Array<[string, string]> }> = [
  { user: "operations", pages: [["home", "/dashboard"], ["report", "/report"], ["faults", "/faults?mode=history"]] },
  { user: "st-electrical", pages: [["home", "/dashboard"], ["faults", "/faults?mode=history"], ["points", "/recognition"]] },
  { user: "ct-electrical", pages: [["home", "/dashboard"], ["drawings", "/drawings"]] },
  { user: "maintenance-manager", pages: [["home", "/dashboard"], ["analytics", "/analytics"], ["reports", "/reports"], ["watch", "/watch"]] },
  { user: "hr", pages: [["recognition", "/recognition"]] },
  { user: "admin", pages: [["people", "/people"]] },
];

test("@mobile login", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${dir}/login.png`, fullPage: true });
});

for (const { user, pages } of shots) {
  test(`@mobile ${user}`, async ({ page }) => {
    await signIn(page, user);
    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/${user}-${name}.png`, fullPage: true });
    }
    if (user === "st-electrical") {
      await page.goto("/faults?mode=history");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${dir}/${user}-fault-detail.png`, fullPage: false });
      await page.getByRole("button", { name: "More" }).click();
      await page.screenshot({ path: `${dir}/${user}-menu.png` });
    }
  });
}
