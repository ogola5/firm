import { Suspense, lazy } from "react";
import { type User } from "../../auth";
import { Page, PageHeader } from "../../components/ui/page";
import { MyJobs } from "../jobs/MyJobs";
import { People } from "../people/People";
import { ChiefTechnicianDashboard } from "./ChiefTechnicianDashboard";
import { PersonalWorkspace } from "./PersonalWorkspace";
import { RecognitionPanel } from "./RecognitionPanel";

// Charts are only needed by management roles; technicians never download them.
const ManagementOverview = lazy(() => import("./ManagementOverview").then((m) => ({ default: m.ManagementOverview })));

const FIELD_ROLES = [
  "systems_automation", "technician_st", "technician_pt",
  "assistant_engineer", "engineer", "senior_engineer", "chief_engineer",
];

/** Role-specific home screen. */
export function Dashboard({ user }: { user: User }) {
  if (user.role === "technician_ct") return <ChiefTechnicianDashboard user={user} />;
  if (FIELD_ROLES.includes(user.role)) return <MyJobs user={user} />;
  if (user.role === "operations") return <PersonalWorkspace user={user} />;
  if (user.role === "hr_officer") {
    return (
      <Page>
        <PageHeader
          eyebrow="People and appraisal evidence"
          title="Workforce overview"
          description="HR can review attributed work contributions and time measures without opening individual fault records."
        />
        <People user={user} compact />
        <RecognitionPanel />
      </Page>
    );
  }
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground" role="status">Loading summary…</div>}>
      <ManagementOverview user={user} />
    </Suspense>
  );
}
