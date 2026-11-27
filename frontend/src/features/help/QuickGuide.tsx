import { Printer } from "lucide-react";
import { type User } from "../../auth";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Page, PageHeader } from "../../components/ui/page";
import { guideFor, TERMS } from "./guides";

const TERM_TITLES: Record<string, string> = {
  "needs-you": "Needs you now", "open-pickup": "Anyone free takes it", "write-up-check": "The write-up check", escalation: "Escalation",
  library: "Library", "likely-to-fail": "Likely to fail", sync: "Sync",
};

/** One page per role: the daily tasks step by step, a few tips, and the words used. Printable. */
export function QuickGuide({ user }: { user: User }) {
  const guide = guideFor(user.access.home);
  return (
    <Page>
      <PageHeader
        eyebrow={`${user.access.level} · ${user.role_label}`}
        title="Quick guide"
        description={`${user.access.home_title}: ${user.access.home_purpose}`}
        actions={<Button variant="outline" onClick={() => window.print()} className="print:hidden"><Printer /> Print</Button>}
      />
      <div className="mx-auto grid max-w-4xl gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-lg">Your home page</CardTitle></CardHeader>
          <CardContent><ol className="m-0 grid gap-1 pl-5">{guide.welcome.map((line) => <li key={line}>{line}</li>)}</ol></CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          {guide.tasks.map((task) => (
            <Card key={task.title} className="break-inside-avoid">
              <CardHeader className="pb-2"><CardTitle className="text-lg">{task.title}</CardTitle></CardHeader>
              <CardContent><ol className="m-0 grid gap-1 pl-5 text-[15px]">{task.steps.map((step) => <li key={step}>{step}</li>)}</ol></CardContent>
            </Card>
          ))}
        </div>
        {guide.tips.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg">Tips</CardTitle></CardHeader>
            <CardContent><ul className="m-0 grid gap-1 pl-5">{guide.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-lg">Words you will see</CardTitle></CardHeader>
          <CardContent>
            <dl className="m-0 grid gap-2">
              {Object.entries(TERMS).map(([key, text]) => (
                <div key={key}><dt className="font-bold">{TERM_TITLES[key] ?? key}</dt><dd className="m-0 text-muted-foreground">{text}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
