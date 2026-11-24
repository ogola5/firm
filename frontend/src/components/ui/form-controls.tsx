import * as React from "react";
import { cn } from "../../lib/utils";

const control =
  "flex min-h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(control, "min-h-20", className)} {...props} />,
);
Textarea.displayName = "Textarea";

/** Native select: accessible and keyboard-friendly on every device without extra dependencies. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(control, "pr-8", className)} {...props} />,
);
NativeSelect.displayName = "NativeSelect";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("grid gap-1.5 text-sm font-semibold", className)} {...props} />;
}

/**
 * Label + control + hint/validation message.
 * The label points at the control with htmlFor/id rather than wrapping it, so
 * the control's accessible name is exactly the label text (a wrapped input
 * would add its current value to the name).
 */
export function Field({
  label, error, hint, className, children,
}: { label: React.ReactNode; error?: string; hint?: string; className?: string; children: React.ReactElement }) {
  const generated = React.useId();
  const id = (children.props as { id?: string }).id ?? generated;
  const messageId = `${id}-message`;
  const control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id,
    ...(error || hint ? { "aria-describedby": messageId } : {}),
  });
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {control}
      {hint && !error && <span id={messageId} className="text-xs font-normal text-muted-foreground">{hint}</span>}
      {error && <span id={messageId} role="alert" className="text-xs font-semibold text-destructive">{error}</span>}
    </div>
  );
}
