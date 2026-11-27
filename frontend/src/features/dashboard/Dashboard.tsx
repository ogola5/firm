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
import { KnowledgeImpactPanel } from "../library/TypeLibrary";
import { NeedsYouNow } from "./NeedsYouNow";
import { Welcome } from "../help/Help";

// Charts are only needed by management roles; technicians never download them.
const ManagementOverview = lazy(() => import("./ManagementOverview").then((m) => ({ default: m.ManagementOverview })));

/** The home page chosen by the account's access profile, with a first-visit welcome above it. */
export function Dashboard({ user }: { user: User }) {
  return (
    <>
      <div className="mx-auto w-full max-w-[1400px] px-3 pt-4 empty:hidden sm:px-4 md:px-7 md:pt-6 [&>section]:mb-0">
        <Welcome user={user} />
      </div>
      <Home user={user} />
    </>
  );
}

function Home({ user }: { user: User }) {
  switch (user.access.home) {
    case "my_reports":
      return <PersonalWorkspace user={user} before={<NeedsYouNow />} />;
    case "my_jobs":
      // Your own jobs first; what may need attention next comes after them.
      return <MyJobs user={user} before={<NeedsYouNow />} after={<><KnowledgeImpactPanel user={user} /><WatchPanel user={user} /></>} />;
    case "section_oversight":
      return <ChiefTechnicianDashboard user={user} />;
    case "section_engineering":
      return <MyJobs user={user} before={<><NeedsYouNow /><SectionPicture user={user} /></>} after={<><KnowledgeImpactPanel user={user} /><WatchPanel user={user} /></>} />;
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
