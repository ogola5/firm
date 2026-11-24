import { zodResolver } from "@hookform/resolvers/zod";
import { Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { normalizeUser, type User } from "../auth";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Field, Input, NativeSelect } from "../components/ui/form-controls";
import { API_BASE as API, ApiError, api, isOfflineError } from "../offline/api";
import { networkFetch } from "../offline/network";
import { NetworkSimulator } from "../offline/NetworkSimulator";
import { offlineLogin, rememberOfflineSession } from "../offline/session";
import { getSyncEngine } from "../offline/sync";

export type DemoAccount = { username: string; role_label: string; section: string };

const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter a username"),
  password: z.string().min(1, "Enter the password"),
});
type LoginValues = z.infer<typeof loginSchema>;

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "operations", password: "demo123" },
  });
  const username = watch("username");
  const listed = accounts.some((account) => account.username === username);

  useEffect(() => {
    networkFetch(`${API}/api/v1/auth/demo-accounts`).then((response) => response.json()).then(setAccounts).catch(() => setAccounts([]));
  }, []);

  async function signIn({ username, password }: LoginValues) {
    setError("");
    try {
      const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      localStorage.setItem("kpc-token", result.access_token);
      localStorage.setItem("kpc-user", JSON.stringify(result.user));
      localStorage.removeItem("kpc-offline-session");
      // Keep a password verifier (not the password) so this account can sign in offline later.
      void rememberOfflineSession(username, password, result.user, result.access_token).catch(() => undefined);
      getSyncEngine().resumeAfterLogin();
      onLogin(result.user);
      navigate("/dashboard");
    } catch (reason) {
      if (reason instanceof ApiError) {
        setError(reason.status === 401 ? "Invalid username or password." : reason.message);
        return;
      }
      if (!isOfflineError(reason)) {
        setError("Login unavailable. Confirm the backend is running.");
        return;
      }
      try {
        const session = await offlineLogin(username, password);
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
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <section className="w-full max-w-[420px] rounded-xl border border-border bg-card p-8 shadow-[0_12px_40px_rgba(22,49,68,.10)] md:p-10">
        <div className="grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground"><Wrench className="size-7" /></div>
        <p className="mb-0 mt-4 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">KPC / MI / 58</p>
        <h1 className="mt-1">Maintenance Intelligence</h1>
        <p className="mt-0 text-muted-foreground">Synthetic demonstration environment</p>
        <form className="mt-5 grid gap-4" onSubmit={handleSubmit(signIn)} noValidate>
          <Field label="Demonstration account">
            <NativeSelect value={listed ? username : ""} onChange={(event) => setValue("username", event.target.value, { shouldValidate: true })}>
              <option value="">Enter username manually</option>
              {accounts.map((account) => (
                <option key={account.username} value={account.username}>
                  {account.role_label}{account.section ? ` — ${account.section}` : ""} ({account.username})
                </option>
              ))}
            </NativeSelect>
          </Field>
          {!listed && (
            <Field label="Username" error={errors.username?.message}>
              <Input autoComplete="username" aria-invalid={Boolean(errors.username)} {...register("username")} />
            </Field>
          )}
          <Field label="Password" error={errors.password?.message}>
            <Input type="password" autoComplete="current-password" aria-invalid={Boolean(errors.password)} {...register("password")} />
          </Field>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</Button>
        </form>
        <div className="mt-6 grid gap-2 border-t border-border pt-4">
          <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Demonstration network</p>
          <NetworkSimulator compact />
          <p className="m-0 text-xs text-muted-foreground">Accounts that have signed in here while connected can also sign in offline.</p>
        </div>
      </section>
    </main>
  );
}
