import { useQueryClient } from "@tanstack/react-query";
import { type User } from "../../auth";
import { Page, PageHeader } from "../../components/ui/page";
import { ReportBreakdownForm } from "./ReportBreakdownForm";

/** Control-room reporting: the first thing Operations sees. */
export function ReportPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  return (
    <Page>
      <div className="mx-auto grid max-w-4xl gap-5">
        <PageHeader
          className="mb-0"
          eyebrow="Control room"
          title="Report a fault"
          description="Mostly taps: the report writes itself from your answers. Systems Automation gets it as soon as you submit."
        />
        <ReportBreakdownForm user={user} onReported={() => void queryClient.invalidateQueries({ queryKey: ["faults"] })} />
        <p className="m-0 text-xs text-muted-foreground">Illustrative equipment and history. Not connected to KPC systems.</p>
      </div>
    </Page>
  );
}
