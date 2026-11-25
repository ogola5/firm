import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ChoiceButtons } from "../../components/ui/choice";
import { Field, Input } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { type DrawingDifference, type DrawingInfo } from "../../lib/types";
import { api } from "../../offline/api";

type Status = "REPORTED" | "VERIFIED" | "INCORPORATED";

function DifferenceRow({ item, canVerify, canIncorporate, onDone }: { item: DrawingDifference; canVerify: boolean; canIncorporate: boolean; onDone: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [revision, setRevision] = useState("");
  const [error, setError] = useState("");
  async function run(path: string, body: object, message: string) {
    setError("");
    try {
      await api(`/api/v1/drawing-differences/${item.id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      onDone(message);
    } catch (reason) {
      setError(errorMessage(reason, "Not saved."));
    }
  }
  return (
    <article aria-label={`Difference on ${item.equipment_tag}`} className="grid gap-2 border-b border-border py-4 text-sm last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{item.equipment_tag} · <span className="font-normal">{item.equipment_name}</span> <span className="text-xs text-muted-foreground">· {item.section}</span></strong>
        <Badge variant={item.status === "VERIFIED" ? "destructive" : item.status === "INCORPORATED" ? "success" : "warning"} className="normal-case">{item.status_label}</Badge>
      </div>
      <span className="text-base font-semibold">{item.description}</span>
      <span className="text-muted-foreground">
        {item.drawing_number ? `Drawing ${item.drawing_number}${item.drawing_revision ? ` rev ${item.drawing_revision}` : ""}${item.drawing_in_register ? "" : " (not in the register)"} · ` : "Drawing not given · "}
        {item.permanence === "TEMPORARY" ? "Temporary · " : ""}Reported by {item.reported_by}, {spokenTime(item.reported_at)}
        {item.verified_by ? ` · verified by ${item.verified_by}` : ""}{item.incorporated_revision ? ` · drawn in revision ${item.incorporated_revision}` : ""}
      </span>
      {canVerify && item.status === "REPORTED" && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Note (needed if it is not a difference)" className="min-w-[16rem] flex-1"><Input value={note} onChange={(event) => setNote(event.target.value)} /></Field>
          <Button onClick={() => void run("review", { decision: "VERIFIED", note }, "Verified: it now shows on every job card for this equipment.")}>Verified: it differs</Button>
          <Button variant="outline" onClick={() => void run("review", { decision: "REJECTED", note }, "Marked as not a difference.")}>Not a difference</Button>
        </div>
      )}
      {canIncorporate && item.status === "VERIFIED" && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="New drawing revision" className="w-44"><Input value={revision} onChange={(event) => setRevision(event.target.value)} /></Field>
          <Button variant="outline" disabled={!revision.trim()} onClick={() => void run("incorporated", { revision }, "Recorded: the drawing now shows the installation as it is.")}>Drawing updated</Button>
        </div>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
    </article>
  );
}

function Register({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const register = useQuery({
    queryKey: ["drawings", search],
    queryFn: () => api<{ drawings: DrawingInfo[]; digitised: number; total: number; note: string }>(`/api/v1/drawings?search=${encodeURIComponent(search)}`),
  });
  async function link(drawing: DrawingInfo) {
    await api(`/api/v1/drawings/${drawing.id}`, { method: "PATCH", body: JSON.stringify({ document_url: links[drawing.id] ?? "" }) });
    await queryClient.invalidateQueries({ queryKey: ["drawings"] });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Drawing register {register.data ? `· ${register.data.digitised} of ${register.data.total} digitised` : ""}</CardTitle>
        <CardDescription>{register.data?.note}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0">
        <Input aria-label="Search drawings" placeholder="Drawing number or title" value={search} onChange={(event) => setSearch(event.target.value)} className="max-w-sm" />
        {register.data?.drawings.map((drawing) => (
          <div key={drawing.id} className="flex flex-wrap items-end justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
            <span>
              {drawing.document_url ? <a href={drawing.document_url} target="_blank" rel="noreferrer" className="font-bold">{drawing.number}</a> : <strong>{drawing.number}</strong>}
              {drawing.revision ? ` rev ${drawing.revision}` : ""} · {drawing.title}
              <br /><span className="text-muted-foreground">{drawing.discipline} · {drawing.equipment_tags.join(", ") || "no equipment linked"} · {drawing.status_label}</span>
            </span>
            {can(user, "drawings.register") && (
              <span className="flex items-end gap-2">
                <Input aria-label={`Digitised file link for ${drawing.number}`} placeholder="Link to the digitised file" className="w-64"
                  value={links[drawing.id] ?? drawing.document_url ?? ""} onChange={(event) => setLinks({ ...links, [drawing.id]: event.target.value })} />
                <Button size="sm" variant="outline" onClick={() => void link(drawing)}>Save link</Button>
              </span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Where installations no longer match their drawings: verify, then hand to the drawing office. */
export function Drawings({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>(can(user, "drawings.verify") ? "REPORTED" : "VERIFIED");
  const [message, setMessage] = useState("");
  const queue = useQuery({
    queryKey: ["drawing-differences", status],
    queryFn: () => api<{ differences: DrawingDifference[]; can_verify: boolean; can_incorporate: boolean }>(`/api/v1/drawing-differences?status=${status}`),
  });
  const options: Array<{ value: Status; label: string }> = [
    { value: "REPORTED", label: "To verify" },
    { value: "VERIFIED", label: "Verified: drawing to update" },
    { value: "INCORPORATED", label: "Drawing updated" },
  ];
  return (
    <Page>
      <PageHeader eyebrow={`${user.access.level} · ${user.access.scope}`} title="Drawing differences"
        description="Years of repairs mean some equipment no longer matches its drawings. Verified differences are printed on every job card until the drawing is updated." />
      <ChoiceButtons label="Which differences" options={options} value={status} onChange={(value) => { setStatus(value); setMessage(""); }} className="mb-4" />
      {message && <Alert variant="success" className="mb-4">{message}</Alert>}
      {queue.isError && <Alert variant="destructive" className="mb-4">{errorMessage(queue.error, "Not available.")}</Alert>}
      <div className="grid gap-4">
        <Card>
          <CardContent className="pt-2">
            {queue.data && !queue.data.differences.length && <p className="py-4 text-sm text-muted-foreground">Nothing here.</p>}
            {queue.data?.differences.map((item) => (
              <DifferenceRow key={item.id} item={item} canVerify={queue.data!.can_verify} canIncorporate={queue.data!.can_incorporate}
                onDone={(text) => { setMessage(text); void queryClient.invalidateQueries({ queryKey: ["drawing-differences"] }); }} />
            ))}
          </CardContent>
        </Card>
        <Register user={user} />
      </div>
    </Page>
  );
}
