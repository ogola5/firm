import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { normalizeUser, type User } from "../auth";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Field, Input, NativeSelect } from "../components/ui/form-controls";
import { AuthCard } from "../features/account/AuthCard";
import { companyEmail } from "../lib/companyEmail";
import { API_BASE as API, ApiError, api, isOfflineError } from "../offline/api";
import { networkFetch } from "../offline/network";
import { NetworkSimulator } from "../offline/NetworkSimulator";
import { offlineLogin, rememberOfflineSession } from "../offline/session";
import { getSyncEngine } from "../offline/sync";

/** Why the last session ended (e.g. "Your access was changed…"), shown once on the sign-in page. */
export const SIGNED_OUT_REASON = "kpc-signed-out-reason";

export type DemoAccount ={ email: string; username: string; role_label: string; section: string };

const loginSchema = z.object({
  email: companyEmail,
  password: z.string().min(1, "Enter your password"),
});
type LoginValues = z.input<typeof loginSchema>;

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [notice] = useState(() => {
    const reason = sessionStorage.getItem(SIGNED_OUT_REASON) ?? "";
    sessionStorage.removeItem(SIGNED_OUT_REASON);
    return reason;
  });
  const navigate = useNavigate();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "demo.operations@kpc.co.ke", password: "demo123" },
  });
  const email = watch("email").trim().toLowerCase();
  const listed = accounts.some((account) => account.email === email);

  useEffect(() => {
    networkFetch(`${API}/api/v1/auth/demo-accounts`).then((response) => response.json()).then(setAccounts).catch(() => setAccounts([]));
  }, []);

  async function signIn(values: LoginValues) {
    const { email, password } = loginSchema.parse(values);
    setError("");
    setWaiting(false);
    try {
      const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      localStorage.setItem("kpc-token", result.access_token);
      localStorage.setItem("kpc-user", JSON.stringify(result.user));
      localStorage.removeItem("kpc-offline-session");
      // Keep a password verifier (not the password) so this account can sign in offline later.
      void rememberOfflineSession(email, password, result.user, result.access_token).catch(() => undefined);
      getSyncEngine().resumeAfterLogin();
      onLogin(result.user);
      navigate("/dashboard");
    } catch (reason) {
      if (reason instanceof ApiError) {
        setWaiting(reason.status === 403 && reason.message.includes("waiting for approval"));
        setError(reason.message || "Sign-in failed.");
        return;
      }
      if (!isOfflineError(reason)) {
        setError("Sign-in is unavailable. Confirm the server is running.");
        return;
      }
      try {
        const session = await offlineLogin(email, password);
        localStorage.setItem("kpc-token", session.token);
        localStorage.setItem("kpc-user", JSON.stringify(session.user));
        localStorage.setItem("kpc-offline-session", session.tokenExpired ? "token-expired" : "1");
        const cachedUser = normalizeUser(session.user);
        if (!cachedUser) throw new Error("The cached session is invalid.");
        onLogin(cachedUser);
        navigate("/dashboard");
      } catch (offlineReason) {
        setError(`No connection. ${offlineReason instanceof Error ? offlineReason.message : "Offline sign-in failed."}`);
      }
    }
  }

  return (
    <AuthCard title="Sign in" subtitle="Use your KPC email address.">
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit(signIn)} noValidate>
        {notice && <Alert variant="warning" role="status">You were signed out. {notice}</Alert>}
        <Field label="KPC email" error={errors.email?.message}>
          <Input type="email" autoComplete="username" inputMode="email" placeholder="firstname.lastname@kpc.co.ke"
            aria-invalid={Boolean(errors.email)} {...register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" aria-invalid={Boolean(errors.password)} {...register("password")} />
        </Field>
        {error && <Alert variant={waiting ? "warning" : "destructive"}>{error}</Alert>}
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <Link to="/reset-password" className="font-bold">Forgot password?</Link>
          <Link to="/enrol" className="font-bold">Create an account</Link>
        </div>
      </form>

      <div className="mt-6 border-t border-border pt-4">
        <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Demonstration accounts</p>
        <div className="mt-3 grid gap-2">
          <Field label="Demonstration account">
            <NativeSelect
              value={listed ? email : ""}
              onChange={(event) => {
                setValue("email", event.target.value, { shouldValidate: true });
                if (event.target.value) setValue("password", "demo123");
              }}
            >
              <option value="">Choose a demonstration account…</option>
              {accounts.map((account) => (
                <option key={account.email} value={account.email}>
                  {account.role_label}{account.section ? ` — ${account.section}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <p className="m-0 text-xs text-muted-foreground">Synthetic accounts (demo.…@kpc.co.ke, password demo123). No email is ever sent to them.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 border-t border-border pt-4">
        <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Demonstration network</p>
        <NetworkSimulator compact />
        <p className="m-0 text-xs text-muted-foreground">Accounts that have signed in here while connected can also sign in offline.</p>
      </div>
    </AuthCard>
  );
}
