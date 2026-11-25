import { Suspense, lazy } from "react";
import { type User } from "../../auth";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { MyJobs } from "../jobs/MyJobs";
import { People } from "../people/People";
import { AdminHome } from "./AdminHome";
import { ChiefTechnicianDashboard } from "./ChiefTechnicianDashboard";
import { PersonalWorkspace } from "./PersonalWorkspace";
import { RecognitionPanel } from "./RecognitionPanel";
import { SectionPicture } from "./SectionPicture";
import { WatchPanel } from "../watch/WatchList";

// Charts are only needed by management roles; technicians never download them.
const ManagementOverview = lazy(() => import("./ManagementOverview").then((m) => ({ default: m.ManagementOverview })));

/** The home page chosen by the account's access profile (server-defined per level). */
export function Dashboard({ user }: { user: User }) {
  switch (user.access.home) {
    case "my_reports":
      return <PersonalWorkspace user={user} />;
    case "my_jobs":
      return <MyJobs user={user} before={<WatchPanel user={user} />} />;
    case "section_oversight":
      return <ChiefTechnicianDashboard user={user} />;
    case "section_engineering":
      return <MyJobs user={user} before={<><SectionPicture user={user} /><WatchPanel user={user} /></>} />;
    case "administration":
      return <AdminHome user={user} />;
    case "workforce":
      return (
        <Page>
          <PageHeader eyebrow={`${user.access.level} · People and appraisal evidence`} title={user.access.home_title} description={user.access.home_purpose} />
          <People user={user} compact />
          <RecognitionPanel />
        </Page>
      );
    case "maintenance_overview":
    case "om_overview":
    case "supervision":
    case "executive":
      return (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground" role="status">Loading summary…</div>}>
          <ManagementOverview user={user} />
        </Suspense>
      );
    default:
      return (
        <Page>
          <PageHeader title="Welcome" />
          <EmptyState>{user.access.home_purpose || "Your access has not been set up yet. Contact the System Administrator."}</EmptyState>
        </Page>
      );
  }
}
