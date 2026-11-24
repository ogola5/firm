import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, History, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, NativeSelect } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { db } from "../../db";
import { type DataRow } from "../../lib/types";
import { errorMessage, withOfflineFallback } from "../../lib/query";
import { api } from "../../offline/api";

type Availability = "AVAILABLE" | "UNAVAILABLE";

export function PersonalWorkspace({ user }: { user: User }) {
  const isOperator = user.role === "operations";
  const [availability, setAvailability] = useState<Availability>(user.availability_status);

  const queue = useQuery({
    queryKey: ["faults", isOperator ? "reported_by_me" : "mine", user.id],
    queryFn: () => withOfflineFallback(
      async () => {
        const rows = await api<DataRow[]>(isOperator ? "/api/v1/faults?history_scope=reported_by_me" : "/api/v1/faults?queue=mine");
        return isOperator ? rows.filter((item) => !["RESTORED", "CLOSED"].includes(String(item.status))) : rows;
      },
      // Offline: breakdowns on this device that the user reported or holds.
      async () => (await db.faults.toArray()).filter((item) => (isOperator
        ? item.reporter_id === user.id && !["RESTORED", "CLOSED"].includes(String(item.status))
        : item.assigned_user_id === user.id)),
    ),
  });

  const updateAvailability = useMutation({
    mutationFn: (value: Availability) => api("/api/v1/me/availability", {
      method: "PATCH", body: JSON.stringify({ availability_status: value }),
    }),
    onMutate: (value) => {
      const previous = availability;
      setAvailability(value);
      return { previous };
    },
    onError: (_error, _value, context) => context && setAvailability(context.previous),
  });

  const items = queue.data?.data ?? [];
  const fromCache = queue.data?.fromCache ?? false;

  return (
    <Page>
      <PageHeader
        eyebrow={isOperator ? "Operations workspace" : `${user.section || "Maintenance"} · technician workspace`}
        title="My work"
        description="Your active work only. Browse breakdowns when you need the wider history."
        actions={<>
          <Button variant="outline" asChild><Link to="/faults?mode=history"><History /> Find previous work</Link></Button>
          {(user.permissions || []).includes("faults.report") && (
            <Button asChild><Link to="/faults?mode=report"><Plus /> Report a breakdown</Link></Button>
          )}
          {["technician_st", "technician_pt"].includes(user.role) && (
            <Field label="Availability" className="min-w-40">
              <NativeSelect value={availability} onChange={(event) => updateAvailability.mutate(event.target.value as Availability)}>
                <option value="AVAILABLE">Available</option>
                <option value="UNAVAILABLE">Unavailable</option>
              </NativeSelect>
            </Field>
          )}
        </>}
      />
      {updateAvailability.isError && <Alert variant="destructive" className="mb-3">{errorMessage(updateAvailability.error, "Availability could not be updated.")}</Alert>}
      {queue.isError && <Alert variant="destructive" className="mb-3">Could not load breakdowns. Reconnect and try again.</Alert>}
      {fromCache && <Alert variant="warning" className="mb-3">Offline: showing breakdowns saved on this device.</Alert>}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{isOperator ? "Reported by me" : "Assigned to me"}</CardTitle>
              <CardDescription>{isOperator ? "Follow up on the breakdowns you have reported." : "Continue the breakdown work you have taken ownership of."}</CardDescription>
            </div>
            <Badge>{items.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          {queue.isLoading && <p className="m-0 text-sm text-muted-foreground">Loading…</p>}
          {!queue.isLoading && !items.length && (
            <p className="m-0 text-sm text-muted-foreground">{isOperator ? "You have no active breakdowns that you reported." : "You have no active breakdowns assigned to you."}</p>
          )}
          {items.slice(0, 5).map((item) => (
            <Link
              key={String(item.id)}
              to={`/faults?mode=history&fault=${encodeURIComponent(String(item.id))}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-3 text-foreground no-underline hover:bg-muted"
            >
              <span className="grid min-w-0 gap-0.5">
                <strong className="truncate">{String(item.reference)} · {String(item.equipment_tag || "Asset not identified")}</strong>
                <span className="truncate text-sm text-muted-foreground">{String(item.symptom)} · {String(item.status)}</span>
                {item.equipment_confirmed === false && <small className="font-semibold text-warning">Asset identity needs confirmation</small>}
              </span>
              <Badge variant="outline">{String(item.assigned_section || "Needs triage")}</Badge>
            </Link>
          ))}
          {(isOperator || items.length > 5) && (
            <Button variant="link" asChild className="justify-self-start">
              <Link to={isOperator ? "/faults?mode=history&scope=reported_by_me" : "/faults?mode=history&scope=mine"}>
                {isOperator ? "View your report history" : "View all your active work"}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
      <Button variant="link" asChild className="mt-3">
        <Link to="/knowledge"><BookOpen /> Open approved and legacy procedures</Link>
      </Button>
    </Page>
  );
}
