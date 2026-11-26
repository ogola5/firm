import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-extrabold uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        primary: "bg-primary text-primary-foreground",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        destructive: "bg-destructive/10 text-destructive",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Maps workflow statuses to a consistent badge colour. */
export function statusVariant(status: string): BadgeProps["variant"] {
  const value = status.toUpperCase();
  if (["RESTORED", "CLOSED", "APPROVED", "SYNCED", "APPLIED", "SUCCESS", "RESOLVED_APPLIED"].includes(value)) return "success";
  if (["REJECTED", "FAILED", "CRITICAL", "HIGH"].includes(value)) return "destructive";
  if (["CONFLICT", "AWAITING_CHIEF_REVIEW", "CLARIFICATION_REQUESTED", "PENDING", "PENDING_SYNC", "MEDIUM"].includes(value)) return "warning";
  return "default";
}

/** Status in the words people use (fault, section work and procedure statuses). Unknown codes are tidied, not hidden. */
const STATUS_WORDS: Record<string, string> = {
  REPORTED: "Reported", TRIAGED: "Being sorted", ASSIGNED: "Waiting to be taken", ACKNOWLEDGED: "Taken", ON_SITE: "On site",
  DIAGNOSED: "Cause found", AWAITING_CHIEF_REVIEW: "Waiting for sign-off", RESTORED: "Fixed: confirm it works", CLOSED: "Closed",
  OPEN: "Open", ESCALATED: "Handed over", SUBMITTED: "Waiting for review", CHIEF_APPROVED: "Waiting to be published",
  CLARIFICATION_REQUESTED: "Question asked", APPROVED: "Published", SUPERSEDED: "Replaced by a newer version", WITHDRAWN: "Withdrawn",
  REJECTED: "Not accepted", PENDING: "Waiting", CONFIRMED: "Confirmed",
};

export function statusWords(status: string): string {
  const value = (status || "").toUpperCase();
  return STATUS_WORDS[value] ?? (value.charAt(0) + value.slice(1).toLowerCase()).replace(/_/g, " ");
}