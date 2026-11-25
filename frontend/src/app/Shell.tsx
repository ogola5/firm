import {
  AlertTriangle, BookOpen, ClipboardList, FileText, LineChart, CloudOff, Gauge, LogOut, Menu, Plus, Radio, RefreshCw, Search, ShieldCheck, UserCircle, Users, Wrench, X,
} from "lucide-react";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { can, type User } from "../auth";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { refreshOfflineCache } from "../offline/cache";
import { useConnection, useSyncState } from "../offline/hooks";
import { getSyncEngine, requestBackgroundSync, setSyncActor, startAutoSync } from "../offline/sync";

// Route-level code splitting: each area loads only when first opened.
const Dashboard = lazy(() => import("../features/dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const Equipment = lazy(() => import("../features/equipment/Equipment").then((m) => ({ default: m.Equipment })));
const Faults = lazy(() => import("../features/faults/Faults").then((m) => ({ default: m.Faults })));
const Knowledge = lazy(() => import("../features/knowledge/Knowledge").then((m) => ({ default: m.Knowledge })));
const People = lazy(() => import("../features/people/People").then((m) => ({ default: m.People })));
const ProcedureReview = lazy(() => import("../features/procedures/ProcedureReview").then((m) => ({ default: m.ProcedureReview })));
const SyncCentre = lazy(() => import("../offline/SyncCentre").then((m) => ({ default: m.SyncCentre })));
const ReportPage = lazy(() => import("../features/faults/ReportPage").then((m) => ({ default: m.ReportPage })));
const WriteUpVisit = lazy(() => import("../features/jobs/WriteUpVisit").then((m) => ({ default: m.WriteUpVisit })));
const JobCard = lazy(() => import("../features/jobs/JobCard").then((m) => ({ default: m.JobCard })));
const ProcedureDraft = lazy(() => import("../features/jobs/ProcedureDraft").then((m) => ({ default: m.ProcedureDraft })));
const MyAccount = lazy(() => import("../features/account/MyAccount").then((m) => ({ default: m.MyAccount })));
const Reports = lazy(() => import("../features/reports/Reports").then((m) => ({ default: m.Reports })));
const Analytics = lazy(() => import("../features/analytics/Analytics").then((m) => ({ default: m.Analytics })));

// Menu entries come from the account's access profile (server-defined per level); only icons and paths live here.
const AREAS: Record<string, { path: string; icon: ReactNode }> = {
  report: { path: "/report", icon: <Plus /> },
  home: { path: "/dashboard", icon: <Gauge /> },
  analytics: { path: "/analytics", icon: <LineChart /> },
  reports: { path: "/reports", icon: <FileText /> },
  faults: { path: "/faults", icon: <AlertTriangle /> },
  equipment: { path: "/equipment", icon: <Search /> },
  knowledge: { path: "/knowledge", icon: <BookOpen /> },
  approvals: { path: "/approvals", icon: <ShieldCheck /> },
  people: { path: "/people", icon: <Users /> },
  sync: { path: "/sync", icon: <CloudOff /> },
  account: { path: "/account", icon: <UserCircle /> },
};
const HOME_ICONS: Record<string, ReactNode> = { my_jobs: <ClipboardList />, my_reports: <ClipboardList /> };

function NavItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm font-semibold text-sidebar-foreground/80 no-underline hover:bg-white/10 hover:text-sidebar-foreground [&_svg]:size-[18px]",
        isActive && "bg-white/15 text-sidebar-foreground",
      )}
    >
      {icon}
      {children}
    </NavLink>
  );
}

function PageLoading() {
  return <div className="p-8 text-sm text-muted-foreground" role="status">Loading…</div>;
}

export function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const connection = useConnection();
  const online = connection.online;
  const { sync, pending, conflicts } = useSyncState(user.id);
  const offlineSession = localStorage.getItem("kpc-offline-session");
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSyncActor(user.id);
    const stop = startAutoSync();
    return () => {
      stop();
      setSyncActor(null);
    };
  }, [user.id]);

  // Refresh the offline datasets whenever this session is (or becomes) connected.
  useEffect(() => {
    if (online) void refreshOfflineCache(user.permissions || []);
  }, [online, user.id]);

  useEffect(() => {
    if (pending) void requestBackgroundSync();
  }, [pending]);

  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);

  const statusLabel = connection.mode === "offline"
    ? "Offline (simulated)"
    : !connection.browserOnline ? "Offline mode"
      : !connection.serverReachable ? "Server unreachable"
        : connection.mode === "intermittent" ? "Intermittent (simulated)" : "Connected";

  // Everything below follows the account's access profile; the API enforces the same rules.
  const access = user.access;
  const areas = new Set(access.menu.map((item) => item.key));
  const canReport = can(user, "faults.report");
  const worksJobs = can(user, "jobs.work");
  const seesFaults = areas.has("faults");

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr] print:block">
      <aside className={cn(
        "flex flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-screen print:hidden",
        menuOpen ? "fixed inset-0 z-40" : "hidden md:flex",
      )}>
        <div className="flex h-16 items-center justify-between gap-2.5 border-b border-white/10 px-4">
          <span className="flex items-center gap-2.5 font-bold"><Wrench className="size-5" /> KPC Maintenance</span>
          <button className="md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
        <nav className="grid gap-1 p-2.5" aria-label="Main">
          {access.menu.filter((item) => AREAS[item.key]).map((item) => (
            <NavItem key={item.key} to={AREAS[item.key].path} icon={item.key === "home" ? HOME_ICONS[access.home] ?? AREAS.home.icon : AREAS[item.key].icon}>
              {item.label}{item.key === "sync" && conflicts ? ` (${conflicts})` : ""}
            </NavItem>
          ))}
        </nav>
        <div className="mt-auto grid grid-cols-[10px_1fr_32px] items-center gap-2 border-t border-white/10 p-3 text-xs">
          <span className={cn("size-2 rounded-full", online ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
          <NavLink to="/account" className="grid min-w-0 rounded-md text-sidebar-foreground no-underline hover:bg-white/10" title="My account">
            <strong className="truncate">{user.display_name}</strong>
            <span className="truncate text-sidebar-foreground/70">
              {access.level && <span className="mr-1 rounded bg-white/15 px-1 font-bold text-sidebar-foreground">{access.level}</span>}
              {user.role_label}{user.section ? ` · ${user.section}` : ""}
            </span>
            {user.email && <span className="truncate text-sidebar-foreground/70">{user.email}</span>}
          </NavLink>
          <button className="grid size-8 place-items-center rounded-md hover:bg-white/10" onClick={onLogout} aria-label="Log out"><LogOut className="size-4" /></button>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-30 flex min-h-16 print:hidden flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 md:px-7">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
              <Radio className="size-4" /> {statusLabel}
              {offlineSession && <Badge variant="warning">Offline sign-in{offlineSession === "token-expired" ? " · sign in online to send changes" : ""}</Badge>}
              {sync.phase === "auth_required" && <span className="font-semibold text-destructive">Session expired: sign in while connected to send queued work.</span>}
              {sync.phase === "waiting_retry" && pending > 0 && <span>· retrying automatically</span>}
            </div>
          </div>
          <Button variant="outline" onClick={() => void getSyncEngine().syncNow("manual")} disabled={sync.phase === "syncing"}>
            <RefreshCw /> {sync.phase === "syncing" ? "Syncing…" : "Sync now"}
            <span className="grid min-w-5 place-items-center rounded-full bg-secondary px-1.5 text-2xs" aria-label="Changes waiting">{pending}</span>
          </Button>
        </header>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard user={user} />} />
            <Route path="/account" element={<MyAccount user={user} onSignOut={onLogout} />} />
            {areas.has("analytics") && <Route path="/analytics" element={<Analytics user={user} />} />}
            {areas.has("reports") && <Route path="/reports" element={<Reports user={user} />} />}
            {areas.has("equipment") && <Route path="/equipment" element={<Equipment user={user} />} />}
            {seesFaults && <Route path="/faults" element={<Faults user={user} />} />}
            {areas.has("knowledge") && <Route path="/knowledge" element={<Knowledge user={user} />} />}
            {areas.has("approvals") && <Route path="/approvals" element={<ProcedureReview user={user} />} />}
            {areas.has("people") && <Route path="/people" element={<People user={user} />} />}
            {areas.has("sync") && <Route path="/sync" element={<SyncCentre user={user} />} />}
            {canReport && seesFaults && <Route path="/report" element={<ReportPage user={user} />} />}
            {worksJobs && <Route path="/jobs/:faultId/write-up" element={<WriteUpVisit user={user} />} />}
            {seesFaults && <Route path="/jobs/:faultId/card" element={<JobCard user={user} />} />}
            {worksJobs && <Route path="/jobs/:faultId/procedure" element={<ProcedureDraft user={user} />} />}
            <Route path="*" element={<Dashboard user={user} />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
