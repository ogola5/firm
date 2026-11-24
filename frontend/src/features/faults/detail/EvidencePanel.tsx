import { Download } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Field, Textarea } from "../../../components/ui/form-controls";
import { OFFLINE_SAVED } from "../../../lib/messages";
import { errorMessage } from "../../../lib/query";
import { type DataRow } from "../../../lib/types";
import { API_BASE, api, getToken, isOfflineError } from "../../../offline/api";
import { networkFetch } from "../../../offline/network";
import { queueAttachment, queueOperatorUpdate } from "../../../offline/outbox";
import { useDetail } from "./context";

const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log";

function EvidenceUpload() {
  const { user, faultId, done, fail } = useDetail();
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);

  async function upload() {
    const failed: string[] = [];
    const failedFiles: File[] = [];
    let queued = 0;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      try {
        await api(`/api/v1/faults/${encodeURIComponent(faultId)}/attachments`, { method: "POST", body: form });
      } catch (reason) {
        if (isOfflineError(reason)) {
          await queueAttachment(user.id, faultId, file);
          queued += 1;
        } else {
          failedFiles.push(file);
          failed.push(`${file.name}: ${errorMessage(reason, "upload failed")}`);
        }
      }
    }
    setFiles(failedFiles);
    setInputKey((key) => key + 1);
    if (failed.length) fail(null, `Evidence could not be uploaded: ${failed.join(", ")}.`);
    else await done(queued ? `Evidence: ${OFFLINE_SAVED}` : "Evidence added to this breakdown.");
  }

  return (
    <div className="grid gap-2">
      <Field label="Add images, PDFs, or text/log evidence (10 MiB max per file)" hint={files.map((file) => file.name).join(", ") || undefined}>
        <input key={inputKey} type="file" className="text-sm" accept={ACCEPT} multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} />
      </Field>
      {files.length > 0 && <Button type="button" variant="outline" className="justify-self-start" onClick={upload}>Upload evidence</Button>}
    </div>
  );
}

function OperatorUpdateForm() {
  const { user, faultId, done, fail } = useDetail();
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = note.trim();
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/operator-updates`, { method: "POST", body: JSON.stringify({ note: text }) });
      setNote("");
      await done("Progress update sent to the responding teams.");
    } catch (reason) {
      if (isOfflineError(reason) && text) {
        await queueOperatorUpdate(user, faultId, text);
        setNote("");
        await done(`Progress update: ${OFFLINE_SAVED}`);
        return;
      }
      fail(reason, "Operator update could not be saved.");
    }
  }
  return (
    <form className="grid gap-2 border-t border-border pt-4" onSubmit={submit}>
      <h4 className="m-0">Send an update to the responding teams</h4>
      <Field label="New operating information">
        <Textarea required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a change in conditions, access, or operational impact" />
      </Field>
      <Button type="submit" variant="outline" className="justify-self-start">Send progress update</Button>
    </form>
  );
}

function RestorationConfirmation() {
  const { faultId, done, fail } = useDetail();
  const [comments, setComments] = useState("");
  async function confirm(confirmed: boolean) {
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/operator-confirmation`, { method: "POST", body: JSON.stringify({ confirmed, comments }) });
      setComments("");
      await done(confirmed ? "Operational restoration confirmed; the breakdown is closed." : "Restoration not confirmed; work has returned to the responsible section.", true);
    } catch (reason) {
      fail(reason, "Operator confirmation could not be saved.");
    }
  }
  return (
    <div className="grid gap-2 border-t border-border pt-4">
      <h4 className="m-0">Confirm service restoration</h4>
      <p className="m-0 text-sm text-muted-foreground">Check the valve or equipment against the applicable operating procedure before closing this breakdown.</p>
      <Field label="Confirmation notes">
        <Textarea value={comments} onChange={(event) => setComments(event.target.value)} placeholder="Optional confirmation note; required if service is still affected" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => confirm(true)}>Confirm restored and close</Button>
        <Button type="button" variant="outline" onClick={() => confirm(false)}>Still not working — return to section</Button>
      </div>
    </div>
  );
}

export function EvidencePanel() {
  const { user, faultId, context, can, offline, fail } = useDetail();

  async function download(attachment: DataRow) {
    try {
      const token = getToken();
      const response = await networkFetch(
        `${API_BASE}/api/v1/faults/${encodeURIComponent(faultId)}/attachments/${encodeURIComponent(String(attachment.id))}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!response.ok) throw new Error(await response.text());
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = String(attachment.filename);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) {
      fail(reason, "Evidence could not be downloaded.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Shared evidence and operations updates</p>
        <CardTitle className="mt-1">Progress and evidence</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {context.attachments.map((item) => {
          const assignment = context.assignments.find((entry) => entry.id === item.assignment_id);
          return (
            <div key={String(item.id)} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <div className="grid">
                <strong>{String(item.filename)}</strong>
                <small className="text-muted-foreground">{String(item.uploaded_by)} · {assignment ? `${String(assignment.section)} section` : "Breakdown report"} · {Math.ceil(Number(item.size_bytes) / 1024)} KiB</small>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => download(item)}><Download /> Download</Button>
            </div>
          );
        })}
        {!context.attachments.length && <p className="m-0 text-sm text-muted-foreground">No evidence attached yet.</p>}
        {can.canAttachEvidence && can.status !== "CLOSED" && <EvidenceUpload />}
        {user.role === "operations" && can.status !== "CLOSED" && <OperatorUpdateForm />}
        {context.operator_updates.map((item, index) => (
          <div key={String(item.id ?? `pending-${index}`)} className="grid gap-0.5 border-t border-border pt-2 text-sm">
            <strong>{item.pending_sync ? "Operator update · waiting to sync" : String(item.event_type).replace(/_/g, " ")}</strong>
            <small className="text-muted-foreground">{String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small>
            <p className="m-0">{String(item.note ?? (item.payload as DataRow)?.note ?? (item.payload as DataRow)?.comments ?? "No additional comments")}</p>
          </div>
        ))}
        {!offline && can.canConfirmRestoration && can.status === "RESTORED" && <RestorationConfirmation />}
      </CardContent>
    </Card>
  );
}
