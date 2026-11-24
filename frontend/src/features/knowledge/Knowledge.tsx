import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge, statusVariant } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, Input, Textarea } from "../../components/ui/form-controls";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { Pagination, usePagination } from "../../components/ui/pagination";
import { db } from "../../db";
import { useDebounced } from "../../lib/hooks";
import { errorMessage, withOfflineFallback } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { cn } from "../../lib/utils";
import { api } from "../../offline/api";

type SourceFilter = "ALL" | "LEGACY_PROCEDURE" | "FAULT_DERIVED";
const FILTERS: Array<[SourceFilter, string]> = [
  ["ALL", "All records"],
  ["LEGACY_PROCEDURE", "Legacy work instructions"],
  ["FAULT_DERIVED", "Fault-derived procedures"],
];

async function loadLibrary(search: string, filter: SourceFilter): Promise<DataRow[]> {
  const sourceParam = filter === "ALL" ? "" : `&source_type=${filter}`;
  const [entries, procedures] = await Promise.all([
    api<DataRow[]>(`/api/v1/knowledge?search=${encodeURIComponent(search)}${sourceParam}`),
    api<DataRow[]>("/api/v1/procedure-updates/library"),
  ]);
  await db.knowledge.bulkPut(entries as Array<DataRow & { id: string }>);
  const term = search.toLowerCase();
  const procedureEntries = procedures
    .filter((item) => !term || `${item.title} ${item.observed_symptom} ${item.confirmed_cause}`.toLowerCase().includes(term))
    .map((item) => ({ ...item, source_type: "FAULT_DERIVED", symptom: item.observed_symptom }));
  const knowledgeEntries = entries.map((item) => ({
    ...item, source_type: item.source_type === "LEGACY_PROCEDURE" ? "LEGACY_PROCEDURE" : "FAULT_DERIVED",
  }));
  return [...(filter === "LEGACY_PROCEDURE" ? [] : procedureEntries), ...knowledgeEntries];
}

async function cachedLibrary(search: string): Promise<DataRow[]> {
  const term = search.toLowerCase();
  const [entries, procedures] = await Promise.all([
    db.knowledge.filter((entry) => entry.status === "APPROVED").toArray(),
    db.procedures.toArray(),
  ]);
  const matches = (row: DataRow) => !term || `${row.title} ${row.symptom ?? row.observed_symptom} ${row.confirmed_cause}`.toLowerCase().includes(term);
  return [
    ...procedures.filter(matches).map((item) => ({ ...item, source_type: "FAULT_DERIVED", symptom: item.observed_symptom })),
    ...entries.filter(matches),
  ];
}

const legacySchema = z.object({
  title: z.string().trim().min(3, "Give the instruction a title"),
  legacy_reference: z.string().trim(),
  usage_scope: z.string().trim(),
  symptom: z.string().trim(),
  step_by_step: z.string().trim().min(10, "Write the numbered steps"),
  diagnostic_procedure: z.string().trim(),
  corrective_action: z.string().trim(),
  safety: z.string().trim(),
});
type LegacyValues = z.infer<typeof legacySchema>;

function LegacyInstructionForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LegacyValues>({
    resolver: zodResolver(legacySchema),
    defaultValues: { title: "", legacy_reference: "", usage_scope: "", symptom: "", step_by_step: "", diagnostic_procedure: "", corrective_action: "", safety: "" },
  });
  async function submit(values: LegacyValues) {
    setError("");
    try {
      await api("/api/v1/knowledge", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          source_type: "LEGACY_PROCEDURE",
          instruction_type: "Legacy operating work instruction",
          equipment_id: null,
          confirmed_cause: "Existing equipment/tool operating instruction",
        }),
      });
      onSubmitted();
    } catch (reason) {
      setError(errorMessage(reason, "Legacy work instruction could not be submitted."));
    }
  }
  return (
    <Card className="mb-4">
      <CardHeader>
        <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Legacy / existing equipment</p>
        <CardTitle>Add step-by-step work instruction</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={handleSubmit(submit)} noValidate>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Instruction title" error={errors.title?.message}><Input aria-invalid={Boolean(errors.title)} {...register("title")} /></Field>
            <Field label="Legacy reference"><Input placeholder="Document, tool or manual reference" {...register("legacy_reference")} /></Field>
            <Field label="Equipment / tool scope"><Input placeholder="Tag, model or work area" {...register("usage_scope")} /></Field>
          </div>
          <Field label="Operating or maintenance purpose"><Input placeholder="What this instruction enables or maintains" {...register("symptom")} /></Field>
          <Field label="Step-by-step instructions" error={errors.step_by_step?.message}>
            <Textarea
              className="min-h-32"
              aria-invalid={Boolean(errors.step_by_step)}
              placeholder={"1. Verify permit and isolation.\n2. Inspect the equipment or tool.\n3. Perform the approved work.\n4. Record checks and restore safely."}
              {...register("step_by_step")}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Diagnostic / normal checks"><Textarea {...register("diagnostic_procedure")} /></Field>
            <Field label="Corrective action"><Textarea {...register("corrective_action")} /></Field>
            <Field label="Safety requirements"><Textarea {...register("safety")} /></Field>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" className="justify-self-start" disabled={isSubmitting}>Submit legacy instruction</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function KnowledgeCard({ item }: { item: DataRow }) {
  const isLegacy = item.source_type === "LEGACY_PROCEDURE";
  const steps = String(item.step_by_step || "").split("\n").filter((step) => step.trim());
  return (
    <article className={cn("grid content-start gap-2 rounded-lg border border-border border-t-4 bg-card p-4 text-sm", isLegacy ? "border-t-[#b58a42]" : "border-t-ring")}>
      <div className="flex items-center justify-between gap-2">
        <Badge variant={isLegacy ? "warning" : "default"}>{isLegacy ? "Legacy work instruction" : "Fault-derived procedure"}</Badge>
        <small className="text-muted-foreground">{String(item.reference)} · v{String(item.version)}</small>
      </div>
      <h3 className="m-0 text-base">{String(item.title)}</h3>
      {isLegacy ? <>
        <p className="m-0 border-y border-border py-2 text-muted-foreground">
          <strong className="text-foreground">Legacy reference:</strong> {String(item.legacy_reference || "Not recorded")}<br />
          <strong className="text-foreground">Applies to:</strong> {String(item.usage_scope || "Defined operating scope")}
        </p>
        {steps.length
          ? <ol className="m-0 grid gap-1.5 pl-5">{steps.map((step, index) => <li key={index}>{step.replace(/^\d+\.\s*/, "")}</li>)}</ol>
          : <p className="m-0 text-muted-foreground">Step-by-step text has not been migrated.</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <Badge variant={statusVariant(String(item.status))}>{String(item.status)}</Badge>
          <small className="text-muted-foreground">{String(item.instruction_type || "Legacy work instruction")}</small>
        </div>
      </> : <>
        <p className="m-0"><strong>Symptom:</strong> {String(item.symptom)}</p>
        <p className="m-0"><strong>Cause:</strong> {String(item.confirmed_cause)}</p>
        <p className="m-0"><strong>Diagnostic procedure:</strong> {String(item.diagnostic_procedure || "See linked fault history")}</p>
        <p className="m-0"><strong>Action:</strong> {String(item.corrective_action)}</p>
        {Boolean(item.author_name) && <p className="m-0 text-muted-foreground"><strong className="text-foreground">Contributor:</strong> {String(item.author_name)}</p>}
      </>}
    </article>
  );
}

export function Knowledge({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim());
  const [filter, setFilter] = useState<SourceFilter>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState("");

  const library = useQuery({
    queryKey: ["knowledge", "library", query, filter],
    queryFn: () => withOfflineFallback(() => loadLibrary(query, filter), () => cachedLibrary(query)),
  });
  const items = library.data?.data ?? [];
  const paging = usePagination(items, 12, `${query}|${filter}`);

  return (
    <Page>
      <PageHeader
        eyebrow="Maintenance knowledge"
        title="Approved procedures and knowledge"
        description="Only approved and published entries appear in the reusable library."
        actions={(user.permissions || []).includes("knowledge.contribute") && (
          <Button variant="outline" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "Add legacy instruction"}</Button>
        )}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search symptom, cause or legacy reference" aria-label="Search knowledge" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Knowledge source">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs font-extrabold",
                filter === value ? "border-primary bg-primary text-primary-foreground" : "border-input bg-white text-muted-foreground hover:bg-secondary",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {message && <Alert variant="success" className="mb-3">{message}</Alert>}
      {library.data?.fromCache && <Alert variant="warning" className="mb-3">Offline: showing approved knowledge cached on this device.</Alert>}
      {showCreate && (
        <LegacyInstructionForm onSubmitted={() => {
          setMessage("Legacy work instruction submitted for review.");
          setShowCreate(false);
          setFilter("LEGACY_PROCEDURE");
          void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
        }} />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {paging.visible.map((item) => <KnowledgeCard key={`${String(item.source_type)}-${String(item.id)}`} item={item} />)}
      </div>
      {paging.pageCount > 1 && <div className="mt-3 rounded-lg border border-border bg-card"><Pagination {...paging} /></div>}
      {!library.isLoading && !items.length && <EmptyState>No approved knowledge matches this search.</EmptyState>}
    </Page>
  );
}
