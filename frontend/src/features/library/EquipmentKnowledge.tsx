import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookUser, FileWarning, Ruler } from "lucide-react";
import { spokenTime } from "../../lib/format";
import { type Catalogue, type FaultContext } from "../../lib/types";
import { api } from "../../offline/api";

// Copy of backend/app/services/catalogue.py so write-ups work offline; the server list wins when reachable.
const OFFLINE_CATALOGUE: Catalogue = {
  cause_categories: [
    ["loose_connection", "Loose or broken connection"], ["component_failed", "Electrical or electronic part failed"],
    ["wear", "Wear or end of life"], ["setting", "Wrong setting, parameter or calibration"], ["contamination", "Dirt, water or blockage"],
    ["power_supply", "Power supply problem"], ["communication", "Communication or signal lost"],
    ["trip_latched", "Protection trip latched / alarms would not reset"], ["mechanical_damage", "Mechanical damage"],
    ["leak_seal", "Leak or seal failure"], ["modification", "Unrecorded change (differs from drawing)"],
    ["external", "Operating error or outside cause"], ["not_found", "Cause not found yet"],
  ].map(([value, label]) => ({ value, label })),
  action_types: [
    ["replace", "Replaced a part"], ["repair", "Repaired"], ["tighten", "Tightened or re-terminated"], ["adjust", "Adjusted, set or calibrated"],
    ["reset", "Reset or restarted"], ["clean", "Cleaned or cleared"], ["temporary", "Temporary fix or bypass"],
    ["inspect", "Checked or tested only"], ["other", "Other"],
  ].map(([value, label]) => ({ value, label })),
  difference_permanence: [{ value: "PERMANENT", label: "Permanent change" }, { value: "TEMPORARY", label: "Temporary (to be put back)" }],
};

/** The pick-lists (cause, action): from the server when reachable, the built-in copy otherwise. */
export function useCatalogue() {
  return useQuery({
    queryKey: ["catalogue"], staleTime: Infinity, placeholderData: OFFLINE_CATALOGUE, retry: false,
    queryFn: () => api<Catalogue>("/api/v1/catalogue").catch(() => OFFLINE_CATALOGUE),
  });
}

/**
 * What to know before touching this equipment: why it is on the watch list,
 * where it differs from its drawings, and what experienced colleagues said.
 */
export function EquipmentKnowledge({ context, compact = false }: { context: FaultContext; compact?: boolean }) {
  const differences = context.drawing_differences ?? [];
  const notes = context.expert_notes ?? [];
  const drawings = context.drawings ?? [];
  const watch = context.watch;
  if (!differences.length && !notes.length && !drawings.length && !watch) return null;

  return (
    <section aria-label="Know before you go" className="grid content-start gap-3 rounded-xl border border-border bg-card p-5 text-sm">
      <h2 className="m-0 text-base">Know before you go</h2>
      {watch && (
        <div className="grid gap-1 rounded-md border border-warning/40 bg-warning/5 p-3">
          <strong className="flex items-center gap-1.5 text-warning"><AlertTriangle className="size-4" /> On the "likely to fail" list</strong>
          {watch.reasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      )}
      {differences.length > 0 && (
        <div className="grid gap-2">
          <strong className="flex items-center gap-1.5"><FileWarning className="size-4 text-destructive" /> Differs from the drawing ({differences.length})</strong>
          {differences.map((item) => (
            <div key={item.id} className="grid gap-0.5 border-l-[3px] border-destructive/60 pl-2.5">
              <span className="font-semibold">{item.description}</span>
              <span className="text-xs text-muted-foreground">
                {item.drawing_number ? `Drawing ${item.drawing_number}${item.drawing_revision ? ` rev ${item.drawing_revision}` : ""} · ` : ""}
                {item.permanence === "TEMPORARY" ? "Temporary · " : ""}
                {item.status === "VERIFIED" ? `Verified by ${item.verified_by}` : "Reported, not yet verified"} · {spokenTime(item.reported_at).replace(/ \d\d:\d\d$/, "")}
              </span>
            </div>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className="grid gap-2">
          <strong className="flex items-center gap-1.5"><BookUser className="size-4 text-success" /> From experienced colleagues</strong>
          {notes.map((note) => (
            <div key={note.id} className="grid gap-0.5">
              <span className="font-semibold">{note.title}</span>
              <span><span className="text-muted-foreground">First checks:</span> {note.first_checks}</span>
              {!compact && note.what_fools_people && <span><span className="text-muted-foreground">What fools people:</span> {note.what_fools_people}</span>}
              {!compact && note.tricks && <span><span className="text-muted-foreground">Tricks:</span> {note.tricks}</span>}
              <span className="text-xs text-muted-foreground">{note.credit}</span>
            </div>
          ))}
        </div>
      )}
      {drawings.length > 0 && (
        <div className="grid gap-1">
          <strong className="flex items-center gap-1.5"><Ruler className="size-4" /> Drawings</strong>
          {drawings.map((drawing) => (
            <span key={drawing.id}>
              {drawing.document_url
                ? <a href={drawing.document_url} target="_blank" rel="noreferrer" className="font-semibold">{drawing.number}</a>
                : <span className="font-semibold">{drawing.number}</span>}
              {drawing.revision ? ` rev ${drawing.revision}` : ""} · {drawing.title}
              <span className="text-xs text-muted-foreground"> · {drawing.status === "DIGITISED" ? "digitised" : "paper only"}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
