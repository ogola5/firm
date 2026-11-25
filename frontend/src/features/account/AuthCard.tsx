import { Mail, Wrench } from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router-dom";

/** The frame for the signed-out pages: sign in, create account, reset password, demo mailbox. */
export function AuthCard({ title, subtitle, children, wide = false }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <section className={`w-full ${wide ? "max-w-[640px]" : "max-w-[440px]"} rounded-xl border border-border bg-card p-8 shadow-[0_12px_40px_rgba(22,49,68,.10)] md:p-10`}>
        <div className="grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground"><Wrench className="size-7" /></div>
        <p className="mb-0 mt-4 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">KPC Maintenance</p>
        <h1 className="mt-1">{title}</h1>
        {subtitle && <p className="mt-0 text-muted-foreground">{subtitle}</p>}
        {children}
      </section>
    </main>
  );
}

/** Every email the prototype "sends" lands here instead of a real inbox. */
export function MailboxLink({ email }: { email?: string }) {
  return (
    <Link to={`/mailbox${email ? `?email=${encodeURIComponent(email)}` : ""}`} target="_blank" className="inline-flex items-center gap-1.5 text-sm font-bold">
      <Mail className="size-4" /> Open the demo mailbox
    </Link>
  );
}
