/**
 * Company-email accounts, end to end in the browser: enrol with a KPC address,
 * confirm it with the emailed code (demo mailbox), wait for approval, the
 * System Administrator decides the role and section, then sign in to the
 * dashboard that role gets and see it on My account.
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PASSWORD = "Valves2026x";

async function codeFromMailbox(page: Page, email: string): Promise<string> {
  const mailbox = await page.context().newPage();
  await mailbox.goto(`/mailbox?email=${encodeURIComponent(email)}`);
  const subject = mailbox.getByRole("heading", { name: /Your KPC Maintenance code: \d{6}/ }).first();
  await expect(subject).toBeVisible();
  const code = (await subject.textContent())!.match(/\d{6}/)![0];
  await mailbox.close();
  return code;
}

test("a technician enrols with a KPC email, is approved, and lands on their own dashboard", async ({ page }) => {
  const email = `amina.otieno.${Date.now().toString(36)}@kpc.co.ke`;

  await page.goto("/");
  if (await page.getByRole("button", { name: "Log out" }).isVisible()) await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("link", { name: "Create an account" }).click();

  // Outside addresses are refused before anything is sent.
  await page.getByLabel("KPC email").fill("amina@gmail.com");
  await page.getByLabel("Full name").fill("Amina Otieno");
  await page.getByLabel("Staff number").fill("KPC-20417");
  await page.getByLabel("Your job").selectOption({ label: "Senior Technician (ST)" });
  await page.getByLabel("Your section").selectOption("Electrical");
  await page.getByLabel("Your region").selectOption("Coast");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(/Use your KPC email address \(ending @kpc.co.ke\)/)).toBeVisible();

  await page.getByLabel("KPC email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();

  await page.getByLabel("6-digit code").fill(await codeFromMailbox(page, email));
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByLabel("Type the password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();

  // Before approval: the right password, but no way in, and a clear reason.
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await page.getByLabel("KPC email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/waiting for approval by the System Administrator/)).toBeVisible();

  // The administrator approves, correcting the section.
  await signIn(page, "admin");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "User management" }).click();
  const request = page.getByRole("article", { name: `Request from ${email}` });
  await expect(request.getByText("Senior Technician (ST) — Electrical")).toBeVisible();
  await request.getByLabel("Section").selectOption("Mechanical");
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(`Approved ${email}.`)).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();

  // Signed in, the person gets the technician's view for the section they were given.
  await page.getByLabel("KPC email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "My jobs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "User management" })).toHaveCount(0);

  await page.getByRole("link", { name: "My account" }).first().click();
  await expect(page.getByRole("heading", { name: "Amina Otieno" })).toBeVisible();
  const details = page.getByRole("definition");
  await expect(details.filter({ hasText: email })).toBeVisible();
  await expect(details.filter({ hasText: "Mechanical" })).toBeVisible();
  await expect(details.filter({ hasText: "KPC-20417" })).toBeVisible();
  await expect(page.getByText("Record visits, findings and what was tried")).toBeVisible();
});

// Each level lands on its own home with its own menu, from the account's access profile.
const LEVEL_VIEWS: Array<{ user: string; level: string; heading: string; menu: string[]; notMenu: string[] }> = [
  { user: "operations", level: "OPS", heading: "My reports", menu: ["Report a fault", "Find previous work"], notMenu: ["Analytics", "User management"] },
  { user: "st-electrical", level: "ST", heading: "My jobs", menu: ["Find previous work", "Procedures"], notMenu: ["Analytics", "Procedure review"] },
  { user: "ct-electrical", level: "CT", heading: "Section oversight", menu: ["Analytics", "Procedure review"], notMenu: ["User management"] },
  { user: "chief-engineer-electrical", level: "CE", heading: "Section engineering", menu: ["Analytics", "Procedure review"], notMenu: ["User management"] },
  { user: "maintenance-manager", level: "MM", heading: "Maintenance overview", menu: ["Analytics", "Faults"], notMenu: ["User management", "Report a fault"] },
  { user: "gm-om", level: "GM", heading: "Operations & Maintenance", menu: ["Analytics", "Faults"], notMenu: ["User management"] },
  { user: "hr", level: "HR", heading: "Workforce overview", menu: ["People directory"], notMenu: ["Faults", "Equipment", "Analytics"] },
  { user: "ceo", level: "MD", heading: "Executive summary", menu: ["Analytics"], notMenu: ["Faults", "Equipment", "People directory"] },
  { user: "admin", level: "ADMIN", heading: "Administration", menu: ["User management"], notMenu: ["Procedure review"] },
];

test("each level gets the home page and menu its account allows", async ({ page }) => {
  for (const view of LEVEL_VIEWS) {
    await signIn(page, view.user);
    await expect(page.getByRole("heading", { level: 2, name: view.heading }), view.user).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const item of view.menu) await expect(nav.getByRole("link", { name: item, exact: true }), `${view.user}: ${item}`).toBeVisible();
    for (const item of view.notMenu) await expect(nav.getByRole("link", { name: item, exact: true }), `${view.user}: no ${item}`).toHaveCount(0);
    await expect(page.locator("aside").getByText(view.level, { exact: true })).toBeVisible();
  }
});

test("when the administrator changes someone's level, they are signed out and come back to the new view", async ({ page, browser }) => {
  const email = `peter.mwangi.${Date.now().toString(36)}@kpc.co.ke`;
  await signIn(page, "admin");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "User management" }).click();
  const create = page.locator("details").filter({ hasText: "Create an account directly" });
  await create.getByText("Create an account directly").click();
  await create.getByLabel("Full name").fill("Peter Mwangi");
  await create.getByLabel("KPC email").fill(email);
  await create.getByLabel("Role").selectOption("technician_st");
  await create.getByLabel("Section").selectOption("Electrical");
  await create.getByLabel("Temporary password").fill(PASSWORD);
  await create.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`Created ${email}`)).toBeVisible();

  // Peter signs in on his own computer: Senior Technician view.
  const peterContext = await browser.newContext();
  const peter = await peterContext.newPage();
  await peter.goto("/");
  await peter.getByLabel("KPC email").fill(email);
  await peter.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await peter.getByRole("button", { name: "Sign in" }).click();
  await expect(peter.getByRole("heading", { level: 2, name: "My jobs" })).toBeVisible();

  // Promoted to Chief Technician.
  const row = page.getByRole("row").filter({ hasText: email });
  await row.getByRole("button", { name: "Change access" }).click();
  await row.getByLabel("New level").selectOption("technician_ct");
  await row.getByLabel("New section").selectOption("Electrical");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`${email} is now Chief Technician (CT) — Electrical`)).toBeVisible();

  // His next action is refused, he is signed out with the reason, and signs in to the CT view.
  await peter.getByRole("link", { name: "Find previous work" }).click();
  await expect(peter.getByText(/You were signed out\. Your access was changed by the System Administrator/)).toBeVisible();
  await peter.getByLabel("KPC email").fill(email);
  await peter.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await peter.getByRole("button", { name: "Sign in" }).click();
  await expect(peter.getByRole("heading", { level: 2, name: "Section oversight" })).toBeVisible();
  await peterContext.close();
});

test("forgot password: a code to the KPC email sets a new password", async ({ page }) => {
  await page.goto("/");
  if (await page.getByRole("button", { name: "Log out" }).isVisible()) await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("KPC email").fill("someone@yahoo.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(/Use your KPC email address/)).toBeVisible();
  // An unknown KPC address gets the same answer as a real one.
  await page.getByLabel("KPC email").fill("nobody.at.all@kpc.co.ke");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
});
