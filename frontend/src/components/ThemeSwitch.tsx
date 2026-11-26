import { Monitor, Moon, Sun, SunMedium } from "lucide-react";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { cn } from "../lib/utils";

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: JSX.Element }> = [
  { value: "auto", label: "Like my phone", icon: <Monitor className="size-4" /> },
  { value: "day", label: "Day", icon: <SunMedium className="size-4" /> },
  { value: "night", label: "Night", icon: <Moon className="size-4" /> },
  { value: "sun", label: "Sunlight", icon: <Sun className="size-4" /> },
];

/** Display mode chooser: in the menu (compact) and on My account. */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const [choice, setChoice] = useTheme();
  return (
    <div role="radiogroup" aria-label="Display" className={cn("grid gap-1", compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
      {OPTIONS.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={choice === option.value} title={option.label}
          onClick={() => setChoice(option.value)}
          className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-bold",
            compact ? "border-white/15 text-sidebar-foreground/80 hover:bg-white/10" : "border-input bg-card text-foreground hover:bg-secondary",
            choice === option.value && (compact ? "bg-white/15 text-sidebar-foreground" : "border-primary bg-primary text-primary-foreground hover:bg-primary"))}>
          {option.icon}<span className={compact ? "sr-only" : ""}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
