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
  await page.getByRole("link", { name: "User management" }).click();
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
