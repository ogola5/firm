import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Field, Input } from "../../components/ui/form-controls";
import { companyEmail, newPassword, PASSWORD_HINT } from "../../lib/companyEmail";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";
import { AuthCard, MailboxLink } from "./AuthCard";

const emailSchema = z.object({ email: companyEmail });
const resetSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits"),
  password: newPassword,
  confirm: z.string(),
}).refine((values) => values.password === values.confirm, { path: ["confirm"], message: "The passwords do not match" });

/** Forgot password: a code to the KPC email, then a new password. Ends every other session. */
export function ResetPassword() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const emailForm = useForm<z.input<typeof emailSchema>>({ resolver: zodResolver(emailSchema), defaultValues: { email: "" } });
  const resetForm = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { code: "", password: "", confirm: "" } });

  async function requestCode(values: z.input<typeof emailSchema>) {
    const parsed = emailSchema.parse(values);
    setError("");
    try {
      await api("/api/v1/auth/password-reset/start", { method: "POST", body: JSON.stringify(parsed) });
      setEmail(parsed.email);
    } catch (reason) {
      setError(errorMessage(reason, "Could not send a code."));
    }
  }

  async function reset(values: z.infer<typeof resetSchema>) {
    setError("");
    try {
      const result = await api<{ message: string }>("/api/v1/auth/password-reset/complete", {
        method: "POST", body: JSON.stringify({ email, code: values.code, password: values.password }),
      });
      setDone(result.message);
    } catch (reason) {
      setError(errorMessage(reason, "That did not work. Check the code and try again."));
    }
  }

  if (done) {
    return (
      <AuthCard title="Password changed">
        <Alert variant="success" className="mt-4">{done}</Alert>
        <Button asChild className="mt-4 w-full"><Link to="/">Sign in</Link></Button>
      </AuthCard>
    );
  }

  if (email) {
    const { register, handleSubmit, formState: { errors, isSubmitting } } = resetForm;
    return (
      <AuthCard title="Set a new password" subtitle={`If ${email} has an account, we have emailed it a 6-digit code.`}>
        <Alert variant="warning" className="mt-3">Demonstration: no real email is sent. <MailboxLink email={email} /></Alert>
        <form className="mt-4 grid gap-4" onSubmit={handleSubmit(reset)} noValidate>
          <Field label="6-digit code" error={errors.code?.message}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="max-w-[10rem] text-lg tracking-[0.3em]" {...register("code")} />
          </Field>
          <Field label="New password" hint={PASSWORD_HINT} error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...register("password")} />
          </Field>
          <Field label="Type the new password again" error={errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...register("confirm")} />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" disabled={isSubmitting}>Change password</Button>
          <Link to="/" className="text-sm font-bold">Back to sign in</Link>
        </form>
      </AuthCard>
    );
  }

  const { register, handleSubmit, formState: { errors, isSubmitting } } = emailForm;
  return (
    <AuthCard title="Forgot password" subtitle="We will email a code to your KPC address.">
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit(requestCode)} noValidate>
        <Field label="KPC email" error={errors.email?.message}>
          <Input type="email" autoComplete="username" inputMode="email" placeholder="firstname.lastname@kpc.co.ke" {...register("email")} />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" disabled={isSubmitting}>Email me a code</Button>
        <Link to="/" className="text-sm font-bold">Back to sign in</Link>
      </form>
    </AuthCard>
  );
}
