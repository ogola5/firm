import { useQuery } from "@tanstack/react-query";
import { BookOpen, History, Search, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { type User } from "../auth";
import { Input } from "../components/ui/form-controls";
import { useDebounced } from "../lib/hooks";
import { cn } from "../lib/utils";
import { api, isOfflineError } from "../offline/api";
import { searchCachedEquipment } from "../offline/cache";

type Row = Record<string, unknown>;
type Result = { key: string; label: string; detail: string; to: string; icon: "equipment" | "library" | "history" };

const TECHNICAL = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];

/**
 * Find anything from any screen: a tag or name ("p401", "tank 601 valve") goes to that equipment's page;
 * words can also search the library or earlier faults. Works offline for equipment (from this device).
 */
export function GlobalSearch({ user, areas }: { user: User; areas: Set<string> }) {
  const [open, setOpen] = useState(false); // phones: the search opens over the header
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 200);
  const navigate = useNavigate();
  const location = useLocation();
  const input = useRef<HTMLInputElement>(null);
  const canEquipment = areas.has("equipment");

  const equipment = useQuery({
    queryKey: ["equipment", "search", "global", query],
    enabled: canEquipment && query.length >= 2,
    queryFn: async () => {
      try {
        return await api<Row[]>(`/api/v1/equipment?search=${encodeURIComponent(query)}`);
      } catch (reason) {
        if (isOfflineError(reason)) return searchCachedEquipment(query, TECHNICAL.includes(user.role) ? user.section : undefined);
        throw reason;
      }
    },
  });

  useEffect(() => { setText(""); setOpen(false); }, [location.pathname]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => setActive(0), [query]);

  const results: Result[] = query.length < 2 ? [] : [
    ...(equipment.data ?? []).slice(0, 6).map((row) => ({
      key: `eq-${String(row.id)}`, label: `${String(row.tag)} · ${String(row.name)}`,
      detail: `${String(row.location ?? "")}${row.station ? `, ${String(row.station)}` : ""}`, to: `/equipment/${encodeURIComponent(String(row.id))}`, icon: "equipment" as const,
    })),
    ...(areas.has("library") ? [{ key: "library", label: `Search the library for “${query}”`, detail: "Cases, procedures, expert knowledge", to: `/library?q=${encodeURIComponent(query)}`, icon: "library" as const }] : []),
    ...(areas.has("faults") ? [{ key: "faults", label: `Search earlier faults for “${query}”`, detail: "References, tags, problems, what was done", to: `/faults?mode=history&q=${encodeURIComponent(query)}`, icon: "history" as const }] : []),
  ];

  function go(result: Result) {
    navigate(result.to);
    setText("");
    setOpen(false);
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    if (event.key === "Enter" && results[active]) { event.preventDefault(); go(results[active]); }
    if (event.key === "Escape") { setText(""); setOpen(false); }
  }
  if (!canEquipment && !areas.has("library") && !areas.has("faults")) return null;

  const icons = { equipment: <Wrench className="size-4" />, library: <BookOpen className="size-4" />, history: <History className="size-4" /> };
  return (
    <>
      <button type="button" aria-label="Search" onClick={() => setOpen(true)}
        className="grid size-11 shrink-0 place-items-center rounded-md border border-border text-foreground hover:bg-secondary md:hidden">
        <Search className="size-5" />
      </button>
      <div className={cn("relative md:block md:w-72 lg:w-96", open ? "fixed inset-x-0 top-0 z-50 block bg-card p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] shadow-lg md:static md:p-0 md:shadow-none" : "hidden")}>
        <div className="relative flex items-center gap-2">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden />
          <Input ref={input} role="combobox" aria-expanded={results.length > 0} aria-controls="global-search-results" aria-label="Search equipment, faults and the library"
            placeholder="Find a tag, equipment or problem…" className="pl-9" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKey} />
          {open && <button type="button" aria-label="Close search" className="grid size-11 place-items-center md:hidden" onClick={() => { setOpen(false); setText(""); }}><X className="size-5" /></button>}
        </div>
        {results.length > 0 && (
          <ul id="global-search-results" role="listbox" aria-label="Search results"
            className="absolute inset-x-3 top-full z-50 mt-1 grid max-h-[70vh] overflow-auto rounded-xl border border-border bg-card p-1 shadow-lg md:inset-x-0">
            {results.map((result, index) => (
              <li key={result.key} role="option" aria-selected={index === active}>
                <button type="button" onMouseEnter={() => setActive(index)} onClick={() => go(result)}
                  className={cn("flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left", index === active && "bg-secondary")}>
                  <span className="mt-0.5 text-muted-foreground">{icons[result.icon]}</span>
                  <span className="grid min-w-0"><span className="truncate text-sm font-semibold">{result.label}</span>
                    {result.detail && <span className="truncate text-xs text-muted-foreground">{result.detail}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
