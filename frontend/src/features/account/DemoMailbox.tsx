import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Field, Input } from "../../components/ui/form-controls";
import { companyEmailProblem } from "../../lib/companyEmail";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";
import { AuthCard } from "./AuthCard";

type Message = { id: string; subject: string; body: string; sent_at: string };

/**
 * Demonstration only. The prototype never sends real email (kpc.co.ke is a real
 * domain), so every message it would send is shown here. Disabled on the server
 * with DEMO_MAILBOX=false.
 */
export function DemoMailbox() {
  const [params, setParams] = useSearchParams();
  const address = (params.get("email") ?? "").toLowerCase();
  const [typed, setTyped] = useState(address);
  const valid = Boolean(address) && !companyEmailProblem(address);
  const messages = useQuery({
    queryKey: ["demo-mailbox", address],
    enabled: valid,
    refetchInterval: 5_000,
    queryFn: () => api<Message[]>(`/api/v1/demo/mailbox?email=${encodeURIComponent(address)}`),
  });

  return (
    <AuthCard title="Demo mailbox" subtitle="What the system would have emailed. No real email is sent." wide>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setParams({ email: typed.trim().toLowerCase() }); }}>
        <Field label="Address" className="min-w-[16rem] flex-1">
          <Input type="email" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="firstname.lastname@kpc.co.ke" />
        </Field>
        <Button type="submit" variant="outline">Show</Button>
        {valid && <Button type="button" variant="ghost" onClick={() => void messages.refetch()} aria-label="Refresh"><RefreshCw /></Button>}
      </form>
      {address && !valid && <Alert variant="destructive" className="mt-3">{companyEmailProblem(address)}</Alert>}
      {messages.isError && <Alert variant="destructive" className="mt-3">{errorMessage(messages.error, "The demo mailbox is not available.")}</Alert>}
      {messages.data && !messages.data.length && <p className="mt-4 text-sm text-muted-foreground">No messages for {address} yet.</p>}
      <div className="mt-4 grid gap-3">
        {messages.data?.map((message) => (
          <article key={message.id} aria-label={message.subject} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-base">{message.subject}</h2>
              <span className="text-xs text-muted-foreground">{spokenTime(message.sent_at)}</span>
            </div>
            <p className="mb-0 mt-2 whitespace-pre-line text-sm">{message.body}</p>
          </article>
        ))}
      </div>
    </AuthCard>
  );
}
