import {
  Activity, AlertTriangle, ArrowUpCircle, Library as LibraryIcon, BookOpen, GraduationCap, Ruler, Trophy, ClipboardList, FileText, LineChart, CloudOff, Gauge, LogOut, Menu, Plus, Radio, RefreshCw, Search, ShieldCheck, UserCircle, Users, Wrench, X,
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
import { NotificationBell } from "../features/notifications/Notifications";
import { GlobalSearch } from "./GlobalSearch";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { TourBar } from "../features/tour/Tour";

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
const WatchList = lazy(() => import("../features/watch/WatchList").then((m) => ({ default: m.WatchList })));
const Expertise = lazy(() => import("../features/expertise/Expertise").then((m) => ({ default: m.Expertise })));
const Drawings = lazy(() => import("../features/drawings/Drawings").then((m) => ({ default: m.Drawings })));
const Recognition = lazy(() => import("../features/recognition/Recognition").then((m) => ({ default: m.Recognition })));
const Reports = lazy(() => import("../features/reports/Reports").then((m) => ({ default: m.Reports })));
const Analytics = lazy(() => import("../features/analytics/Analytics").then((m) => ({ default: m.Analytics })));
const LibraryIndex = lazy(() => import("../features/library/TypeLibrary").then((m) => ({ default: m.LibraryIndex })));
const TypeLibraryPage = lazy(() => import("../features/library/TypeLibrary").then((m) => ({ default: m.TypeLibraryPage })));
const EquipmentPage = lazy(() => import("../features/equipment/EquipmentPage").then((m) => ({ default: m.EquipmentPage })));
const SystemPage = lazy(() => import("../features/library/SystemPage").then((m) => ({ default: m.SystemPage })));
const Notifications = lazy(() => import("../features/notifications/Notifications").then((m) => ({ default: m.Notifications })));
const ProcedureVersions = lazy(() => import("../features/procedures/ProcedureVersions").then((m) => ({ default: m.ProcedureVersions })));
const Escalations = lazy(() => import("../features/escalation/Escalation").then((m) => ({ default: m.Escalations })));

// Menu entries come from the account's access profile (server-defined per level); only icons and paths live here.
const AREAS: Record<string, { path: string; icon: ReactNode }> = {
  report: { path: "/report", icon: <Plus /> },
  home: { path: "/dashboard", icon: <Gauge /> },
  escalations: { path: "/escalations", icon: <ArrowUpCircle /> },
  analytics: { path: "/analytics", icon: <LineChart /> },
  reports: { path: "/reports", icon: <FileText /> },
  watch: { path: "/watch", icon: <Activity /> },
  expertise: { path: "/expertise", icon: <GraduationCap /> },
  drawings: { path: "/drawings", icon: <Ruler /> },
  recognition: { path: "/recognition", icon: <Trophy /> },
  faults: { path: "/faults", icon: <AlertTriangle /> },
  equipment: { path: "/equipment", icon: <Search /> },
  library: { path: "/library", icon: <LibraryIcon /> },
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

// Phones: three tabs chosen for each level's daily work, plus "More" for the full menu.
const BOTTOM_TABS: Record<string, string[]> = {
  my_reports: ["report", "home", "faults"],
  my_jobs: ["home", "library", "faults"],
  section_engineering: ["home", "escalations", "faults"],
  section_oversight: ["home", "faults", "approvals"],
  maintenance_overview: ["home", "analytics", "reports"],
  om_overview: ["home", "analytics", "reports"],
  supervision: ["home", "approvals", "analytics"],
  executive: ["home", "analytics", "reports"],
  workforce: ["home", "recognition", "people"],
  administration: ["home", "people", "faults"],
};
const SHORT_LABELS: Record<string, string> = {
  report: "Report", faults: "History", watch: "Watch", analytics: "Analytics", reports: "Reports", approvals: "Reviews",
  people: "People", recognition: "Points", expertise: "Experts", knowledge: "Procedures", equipment: "Equipment",
  drawings: "Drawings", sync: "Sync", account: "Account", escalations: "Escalated", library: "Library",
};
const HOME_SHORT: Record<string, string> = {
  my_jobs: "My jobs", my_reports: "My reports", section_oversight: "Section", section_engineering: "Section",
  maintenance_overview: "Overview", om_overview: "Overview", supervision: "Overview", executive: "Summary",
  workforce: "Workforce", administration: "Admin",
};

function BottomTab({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-bold no-underline [&_svg]:size-[22px]",
        isActive ? "text-primary" : "text-muted-foreground",
      )}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
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
  const iconFor = (key: string) => (key === "home" ? HOME_ICONS[access.home] ?? AREAS.home.icon : AREAS[key]?.icon);
  const tabs = (BOTTOM_TABS[access.home] ?? access.menu.map((item) => item.key)).filter((key) => areas.has(key) && AREAS[key]).slice(0, 3);
  const statusTone = !online ? "bg-amber-500" : connection.mode === "intermittent" ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr] print:block">
      <aside className={cn(
        "flex flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-screen md:overflow-y-auto print:hidden",
        menuOpen ? "fixed inset-0 z-50 overflow-y-auto pb-[env(safe-area-inset-bottom)]" : "hidden md:flex",
      )}>
        <div className="flex h-16 items-center justify-between gap-2.5 border-b border-white/10 px-4 pt-[env(safe-area-inset-top)]">
          <span className="flex items-center gap-2.5 font-bold"><Wrench className="size-5" /> KPC Maintenance</span>
          <button className="grid size-11 place-items-center rounded-md md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X className="size-6" /></button>
        </div>
        <nav className="grid gap-1 p-2.5 [&_a]:min-h-12 md:[&_a]:min-h-10" aria-label="Main">
          {access.menu.filter((item) => AREAS[item.key]).map((item) => (
            <NavItem key={item.key} to={AREAS[item.key].path} icon={item.key === "home" ? HOME_ICONS[access.home] ?? AREAS.home.icon : AREAS[item.key].icon}>
              {item.label}{item.key === "sync" && conflicts ? ` (${conflicts})` : ""}
            </NavItem>
          ))}
        </nav>
        <div className="mt-auto px-3 pb-2" aria-label="Display mode">
          <ThemeSwitch compact />
        </div>
        <div className="grid grid-cols-[10px_1fr_32px] items-center gap-2 border-t border-white/10 p-3 text-xs">
          <span className={cn("size-2 rounded-full", online ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
          <NavLink to="/account" className="grid min-w-0 rounded-md text-sidebar-foreground no-underline hover:bg-white/10" title="My account">
            <strong className="truncate">{user.display_name}</strong>
            <span className="truncate text-sidebar-foreground/70">
              {access.level && <span className="mr-1 rounded bg-white/15 px-1 font-bold text-sidebar-foreground">{access.level}</span>}
              {user.role_label}{user.section ? ` · ${user.section}` : ""}{user.region ? ` · ${user.region}` : ""}
            </span>
            {user.email && <span className="truncate text-sidebar-foreground/70">{user.email}</span>}
          </NavLink>
          <button className="grid size-11 place-items-center rounded-md hover:bg-white/10 md:size-8" onClick={onLogout} aria-label="Log out"><LogOut className="size-5 md:size-4" /></button>
        </div>
      </aside>

      <main className="min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0 print:pb-0">
        <header className="sticky top-0 z-30 flex min-h-14 print:hidden items-center justify-between gap-2 border-b border-border bg-card px-3 pt-[env(safe-area-inset-top)] md:min-h-16 md:flex-wrap md:gap-3 md:px-7 md:py-2">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            {/* Phones: the app name and a status dot; the full status shows from tablet size up. */}
            <span className="flex min-w-0 items-center gap-2 font-bold md:hidden">
              <Wrench className="size-5 shrink-0 text-primary" /><span className="truncate">KPC Maintenance</span>
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
              <span className={cn("size-2.5 shrink-0 rounded-full md:hidden", statusTone)} aria-hidden />
              <Radio className="hidden size-4 md:block" /> <span className="sr-only md:not-sr-only">{statusLabel}</span>
              {offlineSession && <Badge variant="warning">Offline sign-in{offlineSession === "token-expired" ? " · sign in online to send changes" : ""}</Badge>}
              {sync.phase === "auth_required" && <span className="font-semibold text-destructive">Session expired: sign in while connected to send queued work.</span>}
              {sync.phase === "waiting_retry" && pending > 0 && <span className="hidden md:inline">· retrying automatically</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          <GlobalSearch user={user} areas={areas} />
          <NotificationBell />
          <Button variant="outline" className="min-h-11 shrink-0 px-3 md:px-4" onClick={() => void getSyncEngine().syncNow("manual")} disabled={sync.phase === "syncing"}
            aria-label={sync.phase === "syncing" ? "Syncing" : "Sync now"}>
            <RefreshCw className={cn(sync.phase === "syncing" && "animate-spin")} />
            <span className="hidden md:inline">{sync.phase === "syncing" ? "Syncing…" : "Sync now"}</span>
            <span className="grid min-w-5 place-items-center rounded-full bg-secondary px-1.5 text-2xs" aria-label="Changes waiting">{pending}</span>
          </Button>
          </div>
        </header>
        <TourBar />
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard user={user} />} />
            <Route path="/account" element={<MyAccount user={user} onSignOut={onLogout} />} />
            <Route path="/notifications" element={<Notifications user={user} />} />
            {areas.has("analytics") && <Route path="/analytics" element={<Analytics user={user} />} />}
            {areas.has("reports") && <Route path="/reports" element={<Reports user={user} />} />}
            {areas.has("escalations") && <Route path="/escalations" element={<Escalations user={user} />} />}
            {areas.has("watch") && <Route path="/watch" element={<WatchList user={user} />} />}
            {areas.has("expertise") && <Route path="/expertise" element={<Expertise user={user} />} />}
            {areas.has("drawings") && <Route path="/drawings" element={<Drawings user={user} />} />}
            {areas.has("recognition") && <Route path="/recognition" element={<Recognition user={user} />} />}
            {areas.has("equipment") && <Route path="/equipment" element={<Equipment user={user} />} />}
            {areas.has("equipment") && <Route path="/equipment/:id" element={<EquipmentPage user={user} />} />}
            {seesFaults && <Route path="/faults" element={<Faults user={user} />} />}
            {areas.has("library") && <Route path="/library" element={<LibraryIndex user={user} />} />}
            {areas.has("library") && <Route path="/library/systems/:id" element={<SystemPage user={user} />} />}
            {areas.has("library") && <Route path="/library/:code" element={<TypeLibraryPage user={user} />} />}
            {(areas.has("library") || areas.has("approvals")) && <Route path="/procedures/:id/versions" element={<ProcedureVersions user={user} />} />}
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

      {/* Phones: the daily destinations under the thumb; "More" opens the full menu, account and sign-out. */}
      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-border bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-4px_16px_rgba(22,49,68,.08)] backdrop-blur md:hidden print:hidden">
        {tabs.map((key) => (
          <BottomTab key={key} to={AREAS[key].path} icon={iconFor(key)} label={key === "home" ? HOME_SHORT[access.home] ?? "Home" : SHORT_LABELS[key] ?? key} />
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="More"
          aria-expanded={menuOpen}
          className="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-bold text-muted-foreground [&_svg]:size-[22px]"
        >
          <Menu />
          <span>More</span>
          {conflicts > 0 && <span className="absolute right-3 top-1.5 size-2.5 rounded-full bg-destructive" aria-label={`${conflicts} conflicts`} />}
        </button>
      </nav>
    </div>
  );
}
