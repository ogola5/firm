/**
 * The knowledge library as people meet it: a technician on a phone looks up the problem on a type of
 * equipment; an author sees their procedure helped colleagues; an owner sees what needs checking;
 * the Chief Engineer names an owner; HR sees knowledge contribution marked as proposed.
 * Screenshots go to screens/library/.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const dir = "screens/library";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function phone(browser: Browser): Promise<Page> {
  return (await browser.newContext({ ...PHONE, baseURL: test.info().project.use.baseURL })).newPage();
}

test("a technician on a phone finds what worked and what didn't for a pump that won't start", async ({ browser }) => {
  const page = await phone(browser);
  await signIn(page, "st-mechanical");
  await page.getByRole("navigation", { name: "Quick" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.screenshot({ path: `${dir}/1-library-phone.png`, fullPage: true });
  await page.getByLabel("Find a type of equipment").fill("pump");
  await page.getByRole("link", { name: "Pumps library" }).click();

  const problem = page.getByRole("region", { name: "Problem: Won't start" }).or(page.getByLabel("Problem: Won't start"));
  await expect(problem.getByText("Latched trip in the vibration monitor").first()).toBeVisible();
  await expect(problem.getByText("Reset from SCADA at the local workstation").first()).toBeVisible();
  await expect(problem.getByText(/Worked \d+×/).first()).toBeVisible();
  await expect(page.getByText(/Knowledge owner/).first()).toBeVisible();
  await page.screenshot({ path: `${dir}/2-pumps-phone.png`, fullPage: true });
});

test("authors see their knowledge helped; owners see what needs checking; the CE names an owner; HR sees it proposed", async ({ page }) => {
  await signIn(page, "pt-mechanical");
  const impact = page.getByLabel("Your knowledge");
  await expect(impact.getByText(/Your procedures helped colleagues fix \d+ fault/)).toBeVisible();
  await page.screenshot({ path: `${dir}/3-author-home.png`, fullPage: true });

  await signIn(page, "ct-electrical");
  await expect(page.getByLabel("Your knowledge").getByText("Needs checking")).toBeVisible();

  await page.goto("/library/MOV");
  await expect(page.getByText(/check before relying on it/).first()).toBeVisible();
  await page.screenshot({ path: `${dir}/4-valves-fading.png`, fullPage: true });

  await signIn(page, "chief-engineer-electrical");
  await page.goto("/library/VFD");
  await page.getByRole("button", { name: /Name an owner|Change owner/ }).click();
  const owner = page.getByLabel("Owner", { exact: true });
  await expect(owner.locator("option").nth(1)).toBeAttached();
  await owner.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Knowledge owner named.")).toBeVisible();

  await signIn(page, "hr");
  await page.goto("/people");
  await expect(page.getByText(/Knowledge contribution in appraisal: proposed/)).toBeVisible();
});
