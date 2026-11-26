import { WifiOff } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "../lib/utils";
import { getNetworkMode, setNetworkMode, type NetworkMode } from "./network";

const OPTIONS: Array<{ value: NetworkMode; label: string }> = [
  { value: "online", label: "Online" },
  { value: "intermittent", label: "Intermittent" },
  { value: "offline", label: "Offline" },
];

function ModeButtons({ mode, onChange }: { mode: NetworkMode; onChange: (mode: NetworkMode) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Simulated network">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-9 rounded-full border px-3 text-xs font-extrabold",
            mode === option.value ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground hover:bg-secondary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Demonstration-only control that drives the real request path (see network.ts). */
export function NetworkSimulator({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<NetworkMode>(getNetworkMode());
  const choose = (next: NetworkMode) => {
    setNetworkMode(next);
    setMode(next);
  };
  if (compact) return <ModeButtons mode={mode} onChange={choose} />;
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><WifiOff className="size-4" /> Network simulator (demonstration only)</CardTitle>
        <CardDescription>
          Applies to this browser only. Offline blocks every request to the server; intermittent drops about half of them.
          The app's real offline storage and synchronisation are used.
        </CardDescription>
      </CardHeader>
      <CardContent><ModeButtons mode={mode} onChange={choose} /></CardContent>
    </Card>
  );
}
