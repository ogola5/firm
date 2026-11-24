/**
 * Scenario 6 — Knowledge governance (MASTER BUILD PROMPT §16).
 * In this design the section Chief Technician performs technical review and the
 * Supervisor publishes. The spec's "supervisor rejects" step maps to the chief
 * requesting clarification (a rejection is also available).
 *   submit → clarification requested → revised (v2) → approved → published
 *   → a later change creates v3 → earlier versions stay visible.
 */
import { expect, test } from "@playwright/test";
import { cardWithHeading, closedFaultViaApi, openFault, signIn } from "./helpers";

test("Scenario 6: review, revision, publication and versioning of a work procedure", async ({ page, request }) => {
  test.setTimeout(240_000);
  const run = Date.now();
  const title = `Seal replacement on pump vibration ${run}`;
  const { faultId } = await closedFaultViaApi(request, {
    section: "Mechanical", technician: "st-mechanical", symptom: `E2E pump vibration ${run}`,
  });

  // The technician submits version 1.
  await signIn(page, "st-mechanical");
  await openFault(page, faultId);
  await page.getByLabel("Procedure title").fill(title);
  await page.getByLabel("Observed symptom").fill("High vibration at the pump bearing housing");
  await page.getByLabel("Confirmed cause").fill("Worn mechanical seal");
  await page.getByLabel("Diagnostic procedure").fill("Measure vibration; inspect seal faces.");
  await page.getByLabel("Corrective action", { exact: true }).fill("Replace the seal.");
  await page.getByRole("button", { name: "Submit for chief technical review" }).click();
  await expect(page.getByText("Work-procedure update submitted for chief technical review.")).toBeVisible();

  // The chief asks for clarification.
  await signIn(page, "ct-mechanical");
  await page.goto("/approvals");
  const firstReview = cardWithHeading(page, title);
  await firstReview.getByLabel("Review notes").fill("Add the vibration acceptance limit after replacement.");
  await firstReview.getByRole("button", { name: "Request clarification" }).click();
  await expect(page.getByText("Clarification request recorded for the contributor.")).toBeVisible();

  // The technician revises: version 2.
  await signIn(page, "st-mechanical");
  await openFault(page, faultId);
  const timeline = cardWithHeading(page, "Event and review timeline");
  await expect(timeline.getByText("Add the vibration acceptance limit after replacement.")).toBeVisible();
  await timeline.getByRole("button", { name: "Revise this version" }).click();
  await expect(page.getByLabel("Procedure title")).toHaveValue(title);
  await page.getByLabel("Corrective action", { exact: true }).fill("Replace the seal; confirm vibration below 4.5 mm/s (illustrative limit).");
  await page.getByRole("button", { name: "Submit revision" }).click();
  await expect(page.getByText("A new immutable procedure version has been submitted.")).toBeVisible();

  // Technical approval, then publication.
  await signIn(page, "ct-mechanical");
  await page.goto("/approvals");
  await cardWithHeading(page, title).getByRole("button", { name: "Approve technical review" }).click();
  await expect(page.getByText("Technical review approved; awaiting supervisor publication.")).toBeVisible();
  await signIn(page, "supervisor");
  await page.goto("/approvals");
  await cardWithHeading(page, title).getByRole("button", { name: "Approve & publish" }).click();
  await expect(page.getByText("Procedure published to the approved library.")).toBeVisible();

  // A later change to the approved version creates version 3; earlier versions remain.
  await signIn(page, "st-mechanical");
  await openFault(page, faultId);
  const versions = cardWithHeading(page, "Event and review timeline");
  await expect(versions.getByText(/· v1$/)).toBeVisible();
  await expect(versions.getByText(/· v2$/)).toBeVisible();
  await versions.getByRole("button", { name: "Revise this version" }).last().click();
  await page.getByLabel("Safety notes").fill("Lock out the motor and verify zero energy before opening the seal housing.");
  await page.getByRole("button", { name: "Submit revision" }).click();
  await expect(page.getByText("A new immutable procedure version has been submitted.")).toBeVisible();
  await expect(versions.getByText(/· v3$/)).toBeVisible();
  await expect(versions.getByText(/· v1$/)).toBeVisible();

  // The published v2 stays in the library while v3 is under review.
  await page.goto("/knowledge");
  await page.getByLabel("Search knowledge").fill(title);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
