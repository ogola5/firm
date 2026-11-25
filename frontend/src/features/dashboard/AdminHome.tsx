import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Page, PageHeader, Stat } from "../../components/ui/page";
import { api } from "../../offline/api";
import { PeopleSummary } from "../people/People";

type Request = { account_status: string };
type Summary = { total_accounts: number; active_accounts: number; inactive_accounts: number };

/** The System Administrator's home: who is waiting for an account, and the accounts at a glance. */
export function AdminHome({ user }: { user: User }) {
  const requests = useQuery({ queryKey: ["people", "requests"], queryFn: () => api<Request[]>("/api/v1/enrolment/requests") });
  const summary = useQuery({ queryKey: ["people", "summary"], queryFn: () => api<Summary>("/api/v1/users/summary") });
  const waiting = (requests.data ?? []).filter((item) => item.account_status === "PENDING_APPROVAL").length;

  return (
    <Page>
      <PageHeader eyebrow={`${user.access.level} · ${user.role_label}`} title={user.access.home_title} description={user.access.home_purpose} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for approval" value={requests.data ? waiting : "—"} />
        <Stat label="Active accounts" value={summary.data?.active_accounts ?? "—"} />
        <Stat label="Disabled accounts" value={summary.data?.inactive_accounts ?? "—"} />
        <Stat label="All accounts" value={summary.data?.total_accounts ?? "—"} />
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Account requests</CardTitle>
          <CardDescription>Staff enrol with their KPC email. You confirm their level (ST, PT, CT, AE, E, SE, CE, MM, GM, HR…) and section; that decides everything they see.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {waiting > 0
            ? <Alert variant="warning">{waiting} request(s) waiting for your decision.</Alert>
            : requests.data && <p className="m-0 text-sm text-muted-foreground">No requests waiting.</p>}
          <Button asChild className="justify-self-start"><Link to="/people">Open user management</Link></Button>
        </CardContent>
      </Card>
      <PeopleSummary />
    </Page>
  );
}
