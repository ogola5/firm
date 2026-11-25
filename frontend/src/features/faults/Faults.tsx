import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, History, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge, statusVariant } from "../../components/ui/badge";
import { Card, CardContent } from "../../components/ui/card";
import { Input, NativeSelect } from "../../components/ui/form-controls";
import { Pagination, usePagination } from "../../components/ui/pagination";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { db } from "../../db";
import { useDebounced } from "../../lib/hooks";
import { withOfflineFallback } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { useIsPhone } from "../../lib/useIsPhone";
import { cn } from "../../lib/utils";
import { api } from "../../offline/api";
import { cacheFaults } from "../../offline/cache";
import { FaultDetail } from "./FaultDetail";
import { ReportBreakdownForm, type ReportOutcome } from "./ReportBreakdownForm";

const TECHNICAL_ROLES = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];
const SCOPES = ["mine", "reported_by_me", "worked_by_me"];

async function loadHistory(user: User, scope: string, search: string): Promise<DataRow[]> {
  const params = new URLSearchParams();
  if (scope === "mine") params.set("queue", "mine");
  else if (scope) params.set("history_scope", scope);
  if (search) params.set("search", search);
  const rows = await api<DataRow[]>(`/api/v1/faults?${params.toString()}`);
  await cacheFaults(rows as Array<DataRow & { id: string }>);
  // Reports queued on this device appear until the server acknowledges them.
  const localPending = await db.faults.filter((row) => Boolean(row.offline_pending) && row.reporter_id === user.id).toArray();
  return [...localPending, ...rows];
}

async function cachedHistory(user: User, search: string): Promise<DataRow[]> {
  const cached = await db.faults.toArray();
  const sectionScoped = TECHNICAL_ROLES.includes(user.role);
  const sectionEquipment = new Set((await db.equipment.where("section").equals(user.section || "").primaryKeys()).map(String));
  const term = search.toLowerCase();
  return cached
    .filter((item) => item.offline_pending || !sectionScoped || item.assigned_section === user.section || sectionEquipment.has(String(item.equipment_id)))
    .filter((item) => !term || [item.reference, item.symptom, item.equipment_tag].some((value) => String(value ?? "").toLowerCase().includes(term)))
    .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
}

export function Faults({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get("mode") === "report" ? "report" : "history";
  const requestedScope = searchParams.get("scope") || "";
  const scope = SCOPES.includes(requestedScope) ? requestedScope : "";
  const selectedId = searchParams.get("fault") || "";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim());
  const [message, setMessage] = useState("");
  const canReport = (user.permissions || []).includes("faults.report");
  const technician = TECHNICAL_ROLES.includes(user.role) || user.role === "systems_automation";

  const history = useQuery({
    queryKey: ["faults", "history", user.id, scope, debouncedSearch],
    queryFn: () => withOfflineFallback(() => loadHistory(user, scope, debouncedSearch), () => cachedHistory(user, debouncedSearch)),
    enabled: mode === "history",
  });
  const faults = history.data?.data ?? [];
  const paging = usePagination(faults, 15, `${scope}|${debouncedSearch}`);

  const phone = useIsPhone();
  // Large screens: open the first breakdown beside the list. Phones show one thing at a time instead.
  useEffect(() => {
    if (!phone && mode === "history" && !selectedId && faults.length) select(String(faults[0].id), true);
  }, [mode, selectedId, faults, phone]);

  function select(faultId: string, replace = false) {
    setSearchParams({ mode: "history", ...(scope ? { scope } : {}), fault: faultId }, { replace });
    if (phone) window.scrollTo({ top: 0 });
  }

  function backToList() {
    setSearchParams({ mode: "history", ...(scope ? { scope } : {}) });
  }

  // Phones: an opened breakdown takes the whole screen, with a way back to the list.
  if (phone && mode === "history" && selectedId) {
    return (
      <Page>
        <button type="button" onClick={backToList} className="mb-1 flex min-h-11 items-center gap-1 text-sm font-bold text-primary">
          <ChevronLeft className="size-5" /> Back to list
        </button>
        <FaultDetail key={selectedId} user={user} faultId={selectedId} onRefresh={() => queryClient.invalidateQueries({ queryKey: ["faults"] })} />
      </Page>
    );
  }

  // The form shows its own confirmation (with "Report another"); just refresh lists.
  function onReported(_outcome: ReportOutcome) {
    void queryClient.invalidateQueries({ queryKey: ["faults"] });
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["faults"] });

  return (
    <Page>
      <PageHeader
        eyebrow="Breakdown workflow"
        title={technician ? "Breakdowns" : "Faults"}
        description="Report clearly, confirm uncertain assets safely, and find what was done before."
      />
      <div className="mb-4 flex gap-2 border-b border-border" role="tablist">
        {canReport && (
          <button
            role="tab"
            aria-selected={mode === "report"}
            onClick={() => { setMessage(""); setSearchParams({ mode: "report" }); }}
            className={cn("flex min-h-11 items-center gap-2 border-b-[3px] px-3 font-extrabold", mode === "report" ? "border-ring text-foreground" : "border-transparent text-muted-foreground")}
          >
            <Plus className="size-4" /> <span className="md:hidden">Report</span><span className="hidden md:inline">Report a breakdown</span>
          </button>
        )}
        <button
          role="tab"
          aria-selected={mode === "history"}
          onClick={() => setSearchParams({ mode: "history" })}
          className={cn("flex min-h-11 items-center gap-2 border-b-[3px] px-3 font-extrabold", mode === "history" ? "border-ring text-foreground" : "border-transparent text-muted-foreground")}
        >
          <History className="size-4" /> <span className="md:hidden">History</span><span className="hidden md:inline">Find previous work</span>
        </button>
      </div>

      {message && <Alert variant="success" className="mb-4">{message}</Alert>}
      {mode === "report" && canReport && <ReportBreakdownForm user={user} onReported={onReported} />}

      {mode === "history" && <>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tag, description, symptom, or location" aria-label="Search breakdowns" />
          </div>
          {(technician || user.role === "operations") && (
            <NativeSelect
              className="w-auto"
              value={scope}
              aria-label="Filter previous work"
              onChange={(event) => setSearchParams({ mode: "history", ...(event.target.value ? { scope: event.target.value } : {}) })}
            >
              <option value="">{user.role === "operations" ? "All breakdowns" : "All section work"}</option>
              {technician && <option value="mine">Assigned to me · active</option>}
              <option value="reported_by_me">Reported by me</option>
              {technician && <option value="worked_by_me">Worked by me</option>}
            </NativeSelect>
          )}
        </div>
        {history.data?.fromCache && (
          <Alert variant="warning" className="mb-3">Offline: showing breakdowns cached on this device. Investigations opened before going offline are available.</Alert>
        )}
        {history.isError && <Alert variant="destructive" className="mb-3">Could not load breakdowns. Reconnect and try again.</Alert>}
        <p className="text-sm text-muted-foreground">{phone ? "Tap a breakdown to see what was found and what was tried." : "Select a breakdown to review the reported problem, investigation history, prior fixes and unsuccessful attempts."}</p>
        {phone ? (
          <div className="grid gap-2">
            {paging.visible.map((fault) => (
              <button
                key={String(fault.id)}
                type="button"
                onClick={() => select(String(fault.id))}
                className="grid min-h-16 gap-1 rounded-xl border border-border bg-card p-3 text-left active:bg-muted"
              >
                <span className="flex items-start justify-between gap-2">
                  <strong className="min-w-0 truncate">{String(fault.equipment_tag || "Asset not identified")}</strong>
                  <Badge variant={statusVariant(String(fault.status))} className="shrink-0">{String(fault.status).replace(/_/g, " ")}</Badge>
                </span>
                <span className="text-sm">{String(fault.symptom)}</span>
                <span className="text-xs text-muted-foreground">
                  {String(fault.reference)} · {String(fault.assigned_section || "Unassigned")}{fault.reporter_name ? ` · ${String(fault.reporter_name)}` : ""}
                </span>
                {fault.equipment_confirmed === false && <span className="text-xs font-semibold text-warning">Needs asset confirmation</span>}
              </button>
            ))}
            <Pagination {...paging} />
          </div>
        ) : <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead><TableHead>Equipment / description</TableHead><TableHead>Reported by</TableHead>
                  <TableHead>Problem</TableHead><TableHead>Status</TableHead><TableHead>Section</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.visible.map((fault) => {
                  const id = String(fault.id);
                  return (
                    <TableRow
                      key={id}
                      tabIndex={0}
                      aria-selected={selectedId === id}
                      className={cn("cursor-pointer", selectedId === id && "bg-accent hover:bg-accent")}
                      onClick={() => select(id)}
                      onKeyDown={(event) => { if (event.key === "Enter") select(id); }}
                    >
                      <TableCell className="font-bold">{String(fault.reference)}</TableCell>
                      <TableCell>
                        {String(fault.equipment_tag || "Asset not identified")}
                        {fault.equipment_confirmed === false && <small className="block font-semibold text-warning">Needs asset confirmation</small>}
                      </TableCell>
                      <TableCell>{String(fault.reporter_name || "—")}</TableCell>
                      <TableCell>{String(fault.symptom)}</TableCell>
                      <TableCell><Badge variant={statusVariant(String(fault.status))}>{String(fault.status).replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell>{String(fault.assigned_section || "Unassigned")}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination {...paging} />
          </CardContent>
        </Card>}
        {!history.isLoading && !faults.length && <div className="mt-3"><EmptyState>No breakdowns match this search.</EmptyState></div>}
        {selectedId && !phone && <FaultDetail key={selectedId} user={user} faultId={selectedId} onRefresh={refresh} />}
      </>}
    </Page>
  );
}
