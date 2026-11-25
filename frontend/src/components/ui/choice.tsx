import * as React from "react";
import { cn } from "../../lib/utils";

export type Choice<T extends string> = { value: T; label: string; hint?: string };

/**
 * One-click answers (a toggle group). Each option is a real button with
 * aria-pressed, so it works with the keyboard and screen readers.
 */
export function ChoiceButtons<T extends string>({
  label, options, value, onChange, columns, tone = "default", className,
}: {
  label: string;
  options: Array<Choice<T>>;
  value: T | null | "";
  onChange: (value: T) => void;
  /** Lay the options out as an equal-width grid. */
  columns?: number;
  tone?: "default" | "result";
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(columns ? "grid gap-2" : "flex flex-wrap gap-2", className)}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => {
        const pressed = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-12 rounded-lg border px-4 py-2 text-left text-[15px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pressed ? resultTone(tone, option.value) : "border-input bg-white text-foreground hover:bg-secondary",
            )}
          >
            <span className="block">{option.label}</span>
            {option.hint && <span className={cn("block pt-0.5 text-xs font-medium", pressed ? "opacity-90" : "text-muted-foreground")}>{option.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function resultTone(tone: "default" | "result", value: string): string {
  if (tone === "result") {
    if (value === "worked") return "border-success bg-success text-success-foreground";
    if (value === "failed") return "border-destructive bg-destructive text-destructive-foreground";
    return "border-warning bg-warning text-warning-foreground";
  }
  return "border-primary bg-primary text-primary-foreground";
}

export function SectionLabel({ children, htmlFor, id }: { children: React.ReactNode; htmlFor?: string; id?: string }) {
  return htmlFor
    ? <label htmlFor={htmlFor} id={id} className="text-[15px] font-bold">{children}</label>
    : <span id={id} className="text-[15px] font-bold">{children}</span>;
}
