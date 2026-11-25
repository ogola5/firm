import { z } from "zod";

/**
 * Mirrors backend/app/services/accounts.py (normalize_email) so people get the
 * message before submitting. The server is the authority and re-checks.
 */
export const COMPANY_DOMAIN = "kpc.co.ke";
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9_-]|\.(?!\.))*$/;

export function companyEmailProblem(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email) return "Enter your KPC email address";
  if ((email.match(/@/g) ?? []).length !== 1) return `Enter your KPC email address (ending @${COMPANY_DOMAIN})`;
  const [local, domain] = email.split("@");
  if (domain !== COMPANY_DOMAIN) return `Use your KPC email address (ending @${COMPANY_DOMAIN}). Personal or other addresses cannot be used.`;
  if (!local || !LOCAL_PART.test(local) || local.endsWith(".")) return "This email address is not valid";
  return null;
}

export const companyEmail = z.string().transform((value) => value.trim().toLowerCase()).superRefine((value, context) => {
  const problem = companyEmailProblem(value);
  if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

export const PASSWORD_HINT = "At least 10 characters, with letters and numbers. Not your name or email.";
export const newPassword = z.string()
  .min(10, "At least 10 characters")
  .regex(/[A-Za-z]/, "Include letters")
  .regex(/\d/, "Include numbers");
