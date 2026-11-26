import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LogOut } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, Input } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { ThemeSwitch } from "../../components/ThemeSwitch";
import { newPassword, PASSWORD_HINT } from "../../lib/companyEmail";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";
import { rememberOfflineSession } from "../../offline/session";

type Account = User & {
  staff_number: string; job_title: string; approved_at: string | null; approved_by: string | null;
  last_login_at: string | null; password_changed_at: string | null; can_do: string[]; can_see: string;
};

const passwordSchema = z.object({
  current_password: z.string().min(1, "Enter your current password"),
  new_password: newPassword,
  confirm: z.string(),
}).refine((values) => values.new_password === values.confirm, { path: ["confirm"], message: "The passwords do not match" });
type PasswordValues = z.infer<typeof passwordSchema>;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-border py-2.5 last:border-0 sm:grid-cols-[11rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm font-semibold">{children}</dd>
    </div>
  );
}

function ChangePassword({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema), defaultValues: { current_password: "", new_password: "", confirm: "" },
  });

  async function submit(values: PasswordValues) {
    setMessage("");
    setError("");
    try {
      const result = await api<{ message: string; access_token: string }>("/api/v1/account/password", {
        method: "POST", body: JSON.stringify({ current_password: values.current_password, new_password: values.new_password }),
      });
      // This device keeps working with a fresh session; every other session has ended.
      localStorage.setItem("kpc-token", result.access_token);
      void rememberOfflineSession(user.email, values.new_password, user as unknown as Record<string, unknown>, result.access_token).catch(() => undefined);
      reset();
      setMessage(result.message);
      await queryClient.invalidateQueries({ queryKey: ["account"] });
    } catch (reason) {
      setError(errorMessage(reason, "Password not changed."));
    }
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit(submit)} noValidate>
      <Field label="Current password" error={errors.current_password?.message}>
        <Input type="password" autoComplete="current-password" {...register("current_password")} />
      </Field>
      <Field label="New password" hint={PASSWORD_HINT} error={errors.new_password?.message}>
        <Input type="password" autoComplete="new-password" {...register("new_password")} />
      </Field>
      <Field label="Type the new password again" error={errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...register("confirm")} />
      </Field>
      {message && <Alert variant="success">{message}</Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button type="submit" variant="outline" className="justify-self-start" disabled={isSubmitting}>Change password</Button>
    </form>
  );
}

type Subscription = { kind: string; label: string; enabled: boolean; default: boolean };

/** Which periodic reports arrive by email. Defaults follow the level; each person can change them. */
function ReportEmails({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const subscriptions = useQuery({
    queryKey: ["account", user.id, "report-subscriptions"],
    queryFn: () => api<{ subscriptions: Subscription[]; schedule: string }>("/api/v1/account/report-subscriptions"),
  });
  const [error, setError] = useState("");

  async function toggle(kind: string, enabled: boolean) {
    setError("");
    try {
      await api("/api/v1/account/report-subscriptions", { method: "PUT", body: JSON.stringify({ kind, enabled }) });
      await queryClient.invalidateQueries({ queryKey: ["account", user.id, "report-subscriptions"] });
    } catch (reason) {
      setError(errorMessage(reason, "Not saved."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reports by email</CardTitle>
        <CardDescription>{subscriptions.data?.schedule ?? "Sent to your KPC email."}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {subscriptions.data?.subscriptions.map((item) => (
          <label key={item.kind} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={item.enabled} onChange={(event) => void toggle(item.kind, event.target.checked)} />
            <span className="font-semibold">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.default ? "(usual for your level)" : ""}</span>
          </label>
        ))}
        {error && <Alert variant="destructive">{error}</Alert>}
      </CardContent>
    </Card>
  );
}

/** Who you are in the system, what you can do and see, and your password. */
export function MyAccount({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const account = useQuery({ queryKey: ["account", user.id], queryFn: () => api<Account>("/api/v1/account") });
  const data = account.data;

  return (
    <Page>
      <PageHeader eyebrow="My account" title={user.display_name} description={user.email} />
      {account.isError && <Alert variant="destructive" className="mb-4">{errorMessage(account.error, "Your account details need a connection.")}</Alert>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Display</CardTitle><CardDescription>Night for night shifts and the control room; Sunlight for outdoors. Saved on this device.</CardDescription></CardHeader>
          <CardContent><ThemeSwitch /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Your details</CardTitle><CardDescription>Your job and section are set by the System Administrator.</CardDescription></CardHeader>
          <CardContent>
            <dl className="m-0">
              <Row label="KPC email">{user.email}</Row>
              <Row label="Staff number">{data?.staff_number || "—"}</Row>
              <Row label="Job in the system">{user.role_label}</Row>
              <Row label="Section">{user.section || "All sections / not section-based"}</Row>
              {data?.job_title && <Row label="Job title">{data.job_title}</Row>}
              <Row label="Approved">{data?.approved_at ? `${spokenTime(data.approved_at)}${data.approved_by ? ` by ${data.approved_by}` : ""}` : "Set up with the demonstration data"}</Row>
              <Row label="Last signed in">{data?.last_login_at ? spokenTime(data.last_login_at) : "—"}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>What you can do</CardTitle><CardDescription>What you can see: {data?.can_see ?? user.visibility_scope}.</CardDescription></CardHeader>
          <CardContent>
            <ul className="m-0 grid gap-1.5 p-0">
              {(data?.can_do ?? []).map((item) => (
                <li key={item} className="flex list-none items-start gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{item}</li>
              ))}
            </ul>
            <p className="mb-0 mt-3 text-xs text-muted-foreground">If this does not match your job, ask the System Administrator to change it.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>{data?.password_changed_at ? `Last changed ${spokenTime(data.password_changed_at)}. ` : ""}Changing it signs you out everywhere else.</CardDescription>
          </CardHeader>
          <CardContent><ChangePassword user={user} /></CardContent>
        </Card>

        {can(user, "reports.view") && <ReportEmails user={user} />}

        <Card>
          <CardHeader><CardTitle>Sign out</CardTitle><CardDescription>On a shared desk computer, always sign out when you finish.</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={onSignOut}><LogOut /> Sign out</Button></CardContent>
        </Card>
      </div>
    </Page>
  );
}
