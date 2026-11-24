import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const alertVariants = cva("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0", {
  variants: {
    variant: {
      info: "border-border bg-card text-foreground",
      success: "border-success/30 bg-success/5 font-semibold text-success",
      warning: "border-warning/30 bg-[#fff8e8] font-semibold text-warning",
      destructive: "border-destructive/30 bg-destructive/5 text-destructive",
    },
  },
  defaultVariants: { variant: "info" },
});

export function Alert({
  className, variant, ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  const role = variant === "destructive" ? "alert" : "status";
  return <div role={role} className={cn(alertVariants({ variant }), className)} {...props} />;
}
