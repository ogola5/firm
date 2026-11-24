import { AlertTriangle, BookOpen, ClipboardList, CloudOff, Gauge, LogOut, Radio, RefreshCw, Search, ShieldCheck, Wrench } from "lucide-react";
import { useEffect } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { type User } from "../auth";
import { Dashboard } from "../features/dashboard/Dashboard";
import { Equipment } from "../features/equipment/Equipment";
import { Faults } from "../features/faults/Faults";
import { Knowledge } from "../features/knowledge/Knowledge";
import { People } from "../features/people/People";
import { ProcedureReview } from "../features/procedures/ProcedureReview";
import { refreshOfflineCache } from "../offline/cache";
import { useConnection, useSyncState } from "../offline/hooks";
import { getSyncEngine, requestBackgroundSync, setSyncActor, startAutoSync } from "../offline/sync";
import { SyncCentre } from "../offline/SyncCentre";

export function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const connection = useConnection();
  const online = connection.online;
  const { sync, pending, conflicts } = useSyncState(user.id);
  const offlineSession = localStorage.getItem("kpc-offline-session");

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

  const statusLabel = connection.mode === "offline"
    ? "Offline (simulated)"
    : !connection.browserOnline ? "Offline mode"
      : !connection.serverReachable ? "Server unreachable"
        : connection.mode === "intermittent" ? "Intermittent (simulated)" : "Connected";

  const peopleOnly = user.role === "hr_officer";
  const executiveOnly = user.role === "managing_director" || user.role === "management";
  const canSeeMaintenance = !peopleOnly && !executiveOnly;
  const canManageUsers = user.role === "system_administrator";
  const canSeePeople = canManageUsers || peopleOnly;
  const canReviewProcedures = ["technician_ct", "chief_engineer", "supervisor"].includes(user.role);
  const technicianRoles = ["systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];
  const technicianView = technicianRoles.includes(user.role);

  return (
    <div className="app-shell">
      <aside>
        <div className="side-brand"><Wrench size={22} /><strong>KPC Maintenance</strong></div>
        <nav>
          <NavLink to="/dashboard">{user.role === "technician_ct" ? <Gauge size={18} /> : technicianView ? <ClipboardList size={18} /> : <Gauge size={18} />} {user.role === "technician_ct" ? "Section oversight" : technicianView ? "My work" : executiveOnly ? "Executive summary" : peopleOnly ? "Workforce overview" : "Dashboard"}</NavLink>
          {canSeeMaintenance && (user.permissions || []).includes("equipment.read") && <NavLink to="/equipment"><Search size={18} /> Equipment</NavLink>}
          {canSeeMaintenance && (user.permissions || []).includes("faults.read") && <NavLink to="/faults"><AlertTriangle size={18} /> {technicianView ? "Browse breakdowns" : "Faults"}</NavLink>}
          {canSeeMaintenance && (user.permissions || []).includes("knowledge.read") && <NavLink to="/knowledge"><BookOpen size={18} /> Knowledge</NavLink>}
          {canSeeMaintenance && canReviewProcedures && <NavLink to="/approvals"><ShieldCheck size={18} /> Procedure review</NavLink>}
          {canSeePeople && <NavLink to="/people"><ShieldCheck size={18} /> {canManageUsers ? "User management" : "People directory"}</NavLink>}
          {canSeeMaintenance && <NavLink to="/sync"><CloudOff size={18} /> Sync{conflicts ? ` (${conflicts})` : ""}</NavLink>}
        </nav>
        <div className="side-user">
          <div className={`status-dot ${online ? "online" : "offline"}`} />
          <div><strong>{user.display_name}</strong><span>{user.role_label}{user.section ? ` · ${user.section}` : ""}</span></div>
          <button className="icon-button" onClick={onLogout} aria-label="Log out"><LogOut size={17} /></button>
        </div>
      </aside>
      <main>
        <header>
          <div className="network-status" role="status">
            <Radio size={15} /> {statusLabel}
            {offlineSession && <span className="tag">Offline sign-in{offlineSession === "token-expired" ? " · sign in online to send changes" : ""}</span>}
            {sync.phase === "auth_required" && <span className="error"> Session expired: sign in while connected to send queued work.</span>}
            {sync.phase === "waiting_retry" && pending > 0 && <span className="muted"> · retrying automatically</span>}
          </div>
          <button className="secondary" onClick={() => void getSyncEngine().syncNow("manual")} disabled={sync.phase === "syncing"}>
            <RefreshCw size={16} /> {sync.phase === "syncing" ? "Syncing…" : "Sync now"} <span className="count" aria-label="Changes waiting">{pending}</span>
          </button>
        </header>
        <Routes>
          <Route path="/dashboard" element={<Dashboard user={user} />} />
          {canSeeMaintenance && (user.permissions || []).includes("equipment.read") && <Route path="/equipment" element={<Equipment user={user} />} />}
          {canSeeMaintenance && (user.permissions || []).includes("faults.read") && <Route path="/faults" element={<Faults user={user} />} />}
          {canSeeMaintenance && (user.permissions || []).includes("knowledge.read") && <Route path="/knowledge" element={<Knowledge user={user} />} />}
          {canSeeMaintenance && canReviewProcedures && <Route path="/approvals" element={<ProcedureReview user={user} />} />}
          {canSeePeople && <Route path="/people" element={<People user={user} />} />}
          {canSeeMaintenance && <Route path="/sync" element={<SyncCentre user={user} />} />}
          <Route path="*" element={<Dashboard user={user} />} />
        </Routes>
      </main>
    </div>
  );
}
