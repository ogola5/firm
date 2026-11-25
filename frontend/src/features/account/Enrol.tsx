import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Field, Input, NativeSelect } from "../../components/ui/form-controls";
import { companyEmail, newPassword, PASSWORD_HINT } from "../../lib/companyEmail";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";
import { AuthCard, MailboxLink } from "./AuthCard";

type Options = {
  roles: Array<{ code: string; label: string; section_required: boolean; region_required?: boolean }>;
  sections: string[];
  regions?: string[];
  demo_mailbox: boolean;
};

const detailsSchema = z.object({
  email: companyEmail,
  display_name: z.string().trim().min(3, "Enter your full name"),
  staff_number: z.string().trim().min(3, "Enter your staff number").regex(/^[A-Za-z0-9/-]+$/, "Letters and numbers only"),
  job_title: z.string().trim().max(80),
  requested_role: z.string().min(1, "Choose your job"),
  requested_section: z.string(),
  requested_region: z.string(),
});
type Details = z.output<typeof detailsSchema>;
type DetailsInput = z.input<typeof detailsSchema>;

const verifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits"),
  password: newPassword,
  confirm: z.string(),
}).refine((values) => values.password === values.confirm, { path: ["confirm"], message: "The passwords do not match" });
type Verify = z.infer<typeof verifySchema>;

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const names = ["Your details", "Confirm your email", "Approval"];
  return (
    <ol className="mt-4 flex gap-2 p-0 text-xs font-bold" aria-label="Steps">
      {names.map((name, index) => (
        <li key={name} aria-current={index + 1 === step ? "step" : undefined}
          className={`flex-1 list-none rounded-md border px-2 py-1.5 ${index + 1 === step ? "border-primary bg-primary text-primary-foreground" : index + 1 < step ? "border-border text-foreground" : "border-border text-muted-foreground"}`}>
          {index + 1}. {name}
        </li>
      ))}
    </ol>
  );
}

/**
 * Create an account: company email, then the emailed code and a password, then
 * the System Administrator approves. The job and section are a request only.
 */
export function Enrol() {
  const options = useQuery({ queryKey: ["enrolment", "options"], queryFn: () => api<Options>("/api/v1/enrolment/options") });
  const [details, setDetails] = useState<Details | null>(null);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const detailsForm = useForm<DetailsInput>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { email: "", display_name: "", staff_number: "", job_title: "", requested_role: "", requested_section: "", requested_region: "" },
  });
  const verifyForm = useForm<Verify>({ resolver: zodResolver(verifySchema), defaultValues: { code: "", password: "", confirm: "" } });
  const role = options.data?.roles.find((item) => item.code === detailsForm.watch("requested_role"));

  async function start(values: DetailsInput) {
    const parsed = detailsSchema.parse(values);
    if (role?.section_required && !parsed.requested_section) {
      detailsForm.setError("requested_section", { message: "Choose your section" });
      return;
    }
    if (role?.region_required && !parsed.requested_region) {
      detailsForm.setError("requested_region", { message: "Choose your region" });
      return;
    }
    setError("");
    try {
      const result = await api<{ message: string }>("/api/v1/enrolment/start", {
        method: "POST",
        body: JSON.stringify({
          ...parsed,
          requested_section: role?.section_required ? parsed.requested_section : "",
          requested_region: role?.region_required ? parsed.requested_region : "",
        }),
      });
      setDetails(parsed);
      setNotice(result.message);
    } catch (reason) {
      setError(errorMessage(reason, "Could not start. Check your details."));
    }
  }

  async function resend() {
    if (!details) return;
    setError("");
    try {
      await api("/api/v1/enrolment/start", { method: "POST", body: JSON.stringify(details) });
      setNotice("A new code is on its way. Earlier codes no longer work.");
    } catch (reason) {
      setError(errorMessage(reason, "Could not send a new code."));
    }
  }

  async function verify(values: Verify) {
    if (!details) return;
    setError("");
    try {
      const result = await api<{ message: string }>("/api/v1/enrolment/verify", {
        method: "POST", body: JSON.stringify({ email: details.email, code: values.code, password: values.password }),
      });
      setDone(result.message);
    } catch (reason) {
      setError(errorMessage(reason, "That did not work. Check the code and try again."));
    }
  }

  if (done) {
    return (
      <AuthCard title="Waiting for approval">
        <Steps step={3} />
        <div className="mt-5 grid gap-3 text-sm">
          <p className="m-0 flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> Your email {details?.email} is confirmed and your password is set.</p>
          <p className="m-0 flex items-start gap-2"><Clock className="mt-0.5 size-5 shrink-0 text-warning" /> The System Administrator will check your request and confirm your job and section. You will get an email when you can sign in.</p>
          {options.data?.demo_mailbox && <MailboxLink email={details?.email} />}
          <Button asChild variant="outline"><Link to="/">Back to sign in</Link></Button>
        </div>
      </AuthCard>
    );
  }

  if (details) {
    const { register, handleSubmit, formState: { errors, isSubmitting } } = verifyForm;
    return (
      <AuthCard title="Confirm your email" subtitle={`We sent a 6-digit code to ${details.email}.`}>
        <Steps step={2} />
        {notice && <p className="mb-0 mt-3 text-sm text-muted-foreground">{notice}</p>}
        {options.data?.demo_mailbox && (
          <Alert variant="warning" className="mt-3">
            Demonstration: no real email is sent. The code is in the demo mailbox. <MailboxLink email={details.email} />
          </Alert>
        )}
        <form className="mt-4 grid gap-4" onSubmit={handleSubmit(verify)} noValidate>
          <Field label="6-digit code" error={errors.code?.message}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="max-w-[10rem] text-lg tracking-[0.3em]"
              aria-invalid={Boolean(errors.code)} {...register("code")} />
          </Field>
          <Field label="Choose a password" hint={PASSWORD_HINT} error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" aria-invalid={Boolean(errors.password)} {...register("password")} />
          </Field>
          <Field label="Type the password again" error={errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" aria-invalid={Boolean(errors.confirm)} {...register("confirm")} />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Checking…" : "Confirm"}</Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button type="button" className="font-bold text-primary underline-offset-4 hover:underline" onClick={() => void resend()}>Send a new code</button>
            <button type="button" className="font-bold text-primary underline-offset-4 hover:underline" onClick={() => { setDetails(null); setError(""); }}>Change my details</button>
          </div>
        </form>
      </AuthCard>
    );
  }

  const { register, handleSubmit, formState: { errors, isSubmitting } } = detailsForm;
  return (
    <AuthCard title="Create an account" subtitle="For KPC staff. Use your KPC email address." wide>
      <Steps step={1} />
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit(start)} noValidate>
        <Field label="KPC email" hint="Ending @kpc.co.ke. Personal addresses cannot be used." error={errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" placeholder="firstname.lastname@kpc.co.ke"
            aria-invalid={Boolean(errors.email)} {...register("email")} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full name" error={errors.display_name?.message}>
            <Input autoComplete="name" aria-invalid={Boolean(errors.display_name)} {...register("display_name")} />
          </Field>
          <Field label="Staff number" error={errors.staff_number?.message}>
            <Input aria-invalid={Boolean(errors.staff_number)} {...register("staff_number")} />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Your job" hint="The System Administrator confirms this." error={errors.requested_role?.message}>
            <NativeSelect aria-invalid={Boolean(errors.requested_role)} {...register("requested_role")}>
              <option value="">Choose…</option>
              {options.data?.roles.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </NativeSelect>
          </Field>
          {role?.section_required && (
            <Field label="Your section" error={errors.requested_section?.message}>
              <NativeSelect aria-invalid={Boolean(errors.requested_section)} {...register("requested_section")}>
                <option value="">Choose…</option>
                {options.data?.sections.map((item) => <option key={item}>{item}</option>)}
              </NativeSelect>
            </Field>
          )}
          {role?.region_required && (
            <Field label="Your region" hint="Where you are stationed." error={errors.requested_region?.message}>
              <NativeSelect aria-invalid={Boolean(errors.requested_region)} {...register("requested_region")}>
                <option value="">Choose…</option>
                {options.data?.regions?.map((item) => <option key={item}>{item}</option>)}
              </NativeSelect>
            </Field>
          )}
        </div>
        <Field label="Job title (optional)" hint="As on your contract, e.g. Senior Technician, Electrical." error={errors.job_title?.message}>
          <Input {...register("job_title")} />
        </Field>
        {options.isError && <Alert variant="destructive">Account creation is not available right now. Check your connection.</Alert>}
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" disabled={isSubmitting || !options.data}>{isSubmitting ? "Sending…" : "Email me a code"}</Button>
        <p className="m-0 text-sm">Already have an account? <Link to="/" className="font-bold">Sign in</Link></p>
      </form>
    </AuthCard>
  );
}
