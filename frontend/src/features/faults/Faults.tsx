import { History, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type User } from "../../auth";
import { db } from "../../db";
import { OFFLINE_SAVED } from "../../lib/messages";
import { api, isOfflineError } from "../../offline/api";
import { cacheFaults, searchCachedEquipment } from "../../offline/cache";
import { queueAttachment, queueFaultReport } from "../../offline/outbox";
import { FaultDetail } from "./FaultDetail";

export function Faults({ user }: { user: User }) {
  const [faults, setFaults] = useState<Array<Record<string, unknown>>>([]);
  const [equipmentMatches, setEquipmentMatches] = useState<Array<Record<string, unknown>>>([]);
  const [equipmentId, setEquipmentId] = useState("");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [equipmentConfirmed, setEquipmentConfirmed] = useState(false);
  const [reportedLocation, setReportedLocation] = useState("");
  const [reportedOnBehalf, setReportedOnBehalf] = useState("");
  const [operatingConditions, setOperatingConditions] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [symptom, setSymptom] = useState("");
  const [operationalImpact, setOperationalImpact] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [severity, setSeverity] = useState("Medium");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [repeatInsight, setRepeatInsight] = useState<{ repeat_count?: number; last_occurrence?: { date?: string }; suggested_section?: string } | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyScope, setHistoryScope] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get("mode") === "report" ? "report" : "history";
  const [mode, setMode] = useState<"report" | "history">(initialMode);
  const selectedEquipment = equipmentMatches.find((item) => String(item.id) === equipmentId);
  const technicalRoles = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];

  async function loadFaults(preferredId = "", scope = historyScope, search = historySearch) {
    const params = new URLSearchParams();
    if (scope === "mine") params.set("queue", "mine");
    else if (scope) params.set("history_scope", scope);
    if (search.trim()) params.set("search", search.trim());
    const rows = await api(`/api/v1/faults?${params.toString()}`);
    // Reports queued on this device appear until the server acknowledges them.
    const localPending = await db.faults.filter((row) => Boolean(row.offline_pending) && row.reporter_id === user.id).toArray();
    setFaults([...localPending, ...rows]);
    await cacheFaults(rows);
    if (preferredId) setSelectedId(preferredId);
    else if (!selectedId && rows.length) setSelectedId(String(rows[0].id));
  }

  useEffect(() => {
    const requestedFault = searchParams.get("fault");
    const requestedMode = searchParams.get("mode");
    const requestedScope = searchParams.get("scope") || "";
    if (requestedFault) setSelectedId(requestedFault);
    if (requestedMode === "report" || requestedMode === "history") setMode(requestedMode);
    setHistoryScope(["mine", "reported_by_me", "worked_by_me"].includes(requestedScope) ? requestedScope : "");
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadFaults().catch(async () => {
      const cached = await db.faults.toArray();
      const sectionScoped = technicalRoles.includes(user.role);
      const equipment = await db.equipment.toArray();
      const sectionEquipment = new Set(equipment.filter((item) => item.section === user.section).map((item) => item.id));
      const term = historySearch.trim().toLowerCase();
      const visible = cached
        .filter((item) => item.offline_pending || !sectionScoped || item.assigned_section === user.section || sectionEquipment.has(String(item.equipment_id)))
        .filter((item) => !term || [item.reference, item.symptom, item.equipment_tag].some((value) => String(value ?? "").toLowerCase().includes(term)))
        .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
      setFaults(visible);
      if (!selectedId && visible.length) setSelectedId(String(visible[0].id));
      setError("Offline: showing breakdowns cached on this device. Investigations opened before going offline are available.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [historyScope, historySearch, user.role, user.section]);

  useEffect(() => {
    const query = equipmentSearch.trim();
    if (query.length < 2) {
      setEquipmentMatches([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api(`/api/v1/equipment?search=${encodeURIComponent(query)}`)
        .then((items) => { if (active) setEquipmentMatches(items); })
        .catch(async (reason) => {
          const sectionScoped = technicalRoles.includes(user.role);
          const cached = isOfflineError(reason) ? await searchCachedEquipment(query, sectionScoped ? user.section : undefined) : [];
          if (active) setEquipmentMatches(cached);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [equipmentSearch]);

  useEffect(() => {
    if (!equipmentId || !equipmentConfirmed) {
      setRepeatInsight(null);
      return;
    }
    api(`/api/v1/intelligence/equipment/${encodeURIComponent(equipmentId)}`)
      .then(setRepeatInsight)
      .catch(() => setRepeatInsight(null));
  }, [equipmentId, equipmentConfirmed]);

  async function report() {
    if (!symptom.trim() || !operationalImpact.trim() || (!equipmentSearch.trim() && !reportedLocation.trim())) {
      setError("Add what is happening, its effect on operation, and either an equipment description or a known location.");
      return;
    }
    const payload = {
      ...(equipmentId ? { equipment_id: equipmentId } : {}),
      equipment_confirmed: Boolean(equipmentId && equipmentConfirmed),
      reported_equipment_text: equipmentSearch.trim(),
      reported_location: reportedLocation.trim(),
      reported_on_behalf_of: reportedOnBehalf.trim(),
      operating_conditions: operatingConditions.trim(),
      category: String(selectedEquipment?.category || "Unconfirmed"),
      symptom: symptom.trim(),
      severity,
      description: additionalDetails.trim(),
      operational_impact: operationalImpact.trim(),
    };
    let created: { id: string; reference: string; asset_confirmation_required?: boolean };
    try {
      created = await api("/api/v1/faults", { method: "POST", body: JSON.stringify(payload) });
    } catch (reportError) {
      if (isOfflineError(reportError)) {
        const { faultId } = await queueFaultReport(user, payload, { equipment_tag: selectedEquipment?.tag });
        for (const file of evidenceFiles) await queueAttachment(user.id, faultId, file);
        setEvidenceFiles([]);
        setMessage(`${OFFLINE_SAVED} The official reference is assigned when it reaches the server${evidenceFiles.length ? `; ${evidenceFiles.length} evidence file(s) will upload after it` : ""}.`);
        setError("");
        setSelectedId(faultId);
        setMode("history");
        setSearchParams({ mode: "history", fault: faultId });
        setFaults(await db.faults.filter((row) => Boolean(row.offline_pending) && row.reporter_id === user.id).toArray().then((local) => [...local, ...faults.filter((row) => !row.offline_pending)]));
      } else {
        setError(`Could not submit the breakdown. ${reportError instanceof Error ? reportError.message : ""}`);
      }
      return;
    }
    let reportMessage = created.asset_confirmation_required
      ? `Breakdown reported: ${created.reference}. Asset identification is unconfirmed and requires confirmation.`
      : `Breakdown reported: ${created.reference}`;
    const failedUploads: string[] = [];
    for (const file of evidenceFiles) {
      const form = new FormData();
      form.append("file", file);
      try {
        await api(`/api/v1/faults/${encodeURIComponent(created.id)}/attachments`, { method: "POST", body: form });
      } catch (reason) {
        failedUploads.push(`${file.name}: ${reason instanceof Error ? reason.message : "upload failed"}`);
      }
    }
    setEvidenceFiles([]);
    if (failedUploads.length) {
      reportMessage += ` Evidence upload failed for: ${failedUploads.join(", ")}. Reopen this breakdown and attach those files.`;
    }
    setMessage(reportMessage);
    setError("");
    setSelectedId(created.id);
    setMode("history");
    setSearchParams({ mode: "history", fault: created.id });
    setHistoryScope("");
    setHistorySearch("");
    try {
      await loadFaults(created.id, "", "");
    } catch {
      setError("Breakdown reported, but the history list could not be refreshed.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">BREAKDOWN WORKFLOW</p><h2>{technicalRoles.includes(user.role) || user.role === "systems_automation" ? "Breakdowns" : "Faults"}</h2><p className="muted">Report clearly, confirm uncertain assets safely, and find what was done before.</p></div></div>
      <div className="work-tabs">
        {(user.permissions || []).includes("faults.report") && <button className={mode === "report" ? "active" : ""} onClick={() => { setMessage(""); setError(""); setMode("report"); setSearchParams({ mode: "report" }); }}><Plus size={16} /> Report a breakdown</button>}
        <button className={mode === "history" ? "active" : ""} onClick={() => { setMode("history"); setSearchParams({ mode: "history" }); }}><History size={16} /> Find previous work</button>
      </div>
      {mode === "report" && (user.permissions || []).includes("faults.report") && <div className="panel quick-report">
        <h3>Tell us what you can see</h3>
        <p className="muted">Use the tag if you know it. Otherwise describe the equipment and area in your own words. Do not guess a tag.</p>
        <div className="report-grid">
          <label>Equipment tag or description
            <input value={equipmentSearch} onChange={(event) => { setEquipmentSearch(event.target.value); setEquipmentId(""); setEquipmentConfirmed(false); }} placeholder="e.g. inlet valve not opening, near 11-TK-601" />
          </label>
          <label>Known area or location
            <input value={reportedLocation} onChange={(event) => setReportedLocation(event.target.value)} placeholder="Plant, station, area, or nearby equipment" />
          </label>
          <label>What is happening?
            <textarea required value={symptom} onChange={(event) => setSymptom(event.target.value)} placeholder="Describe what you observed" />
          </label>
          <label>Effect on operation
            <textarea required value={operationalImpact} onChange={(event) => setOperationalImpact(event.target.value)} placeholder="What is stopped, reduced, or affected?" />
          </label>
        </div>
        {equipmentSearch.trim().length >= 2 && <div className="asset-matches">
          <strong>Possible equipment matches</strong>
          {equipmentMatches.length ? equipmentMatches.slice(0, 5).map((item) => (
            <button type="button" className={`asset-match ${equipmentId === String(item.id) ? "selected" : ""}`} key={String(item.id)} onClick={() => { setEquipmentId(String(item.id)); setEquipmentConfirmed(false); }}>
              <span><strong>{String(item.tag)} · {String(item.name)}</strong><small>{String(item.location)} · {String(item.station)} · {String(item.section)}</small></span>
              <span className="tag">{equipmentId === String(item.id) ? "Selected suggestion" : "Possible match"}</span>
            </button>
          )) : <p className="muted">No matching asset found. You can still report using your description and location.</p>}
          {equipmentId && <label className="asset-confirmation"><input type="checkbox" checked={equipmentConfirmed} onChange={(event) => setEquipmentConfirmed(event.target.checked)} /> I am sure this is the exact equipment</label>}
          {equipmentId && <button className="text-button" type="button" onClick={() => { setEquipmentId(""); setEquipmentConfirmed(false); }}>Not sure / asset not listed</button>}
        </div>}
        <details className="report-more"><summary>Optional details</summary>
          <label>Operating conditions<textarea value={operatingConditions} onChange={(event) => setOperatingConditions(event.target.value)} placeholder="What was the equipment doing when the issue occurred?" /></label>
          <label>Reported on behalf of (optional)<input value={reportedOnBehalf} onChange={(event) => setReportedOnBehalf(event.target.value)} placeholder="Name or team" /></label>
          <label>Additional notes<textarea value={additionalDetails} onChange={(event) => setAdditionalDetails(event.target.value)} placeholder="Anything else that may help the standby team" /></label>
          <label>Priority<select value={severity} onChange={(event) => setSeverity(event.target.value)}>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Evidence (optional; up to 10 MiB per file)<input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log" multiple onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))} /></label>
          {evidenceFiles.length > 0 && <small>{evidenceFiles.map((file) => file.name).join(", ")}</small>}
        </details>
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={report}>Submit breakdown</button>
      </div>}
      {message && <p className="confirmation">{message}</p>}
      {repeatInsight && Number(repeatInsight.repeat_count || 0) > 0 && <div className="repeat-banner">
        <strong>SEEN BEFORE:</strong> Same equipment has {String(repeatInsight.repeat_count)} occurrence(s) in the last 90 days.
        <span>Last: {repeatInsight.last_occurrence ? new Date(String(repeatInsight.last_occurrence.date)).toLocaleDateString() : "—"} · Suggested section: {String(repeatInsight.suggested_section)}</span>
        <span>Routing: Systems Automation responds first; the responsible section will inherit this breakdown history.</span>
      </div>}
      {mode === "history" && <>
        <div className="history-toolbar">
          <div className="search"><Search size={17} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search tag, description, symptom, or location" /></div>
          {(technicalRoles.includes(user.role) || user.role === "systems_automation" || user.role === "operations") && <select value={historyScope} onChange={(event) => {
            const scope = event.target.value;
            setHistoryScope(scope);
            setSelectedId("");
            setSearchParams({ mode: "history", ...(scope ? { scope } : {}) });
          }} aria-label="Filter previous work">
            <option value="">{user.role === "operations" ? "All breakdowns" : "All section work"}</option>
            {(technicalRoles.includes(user.role) || user.role === "systems_automation") && <option value="mine">Assigned to me · active</option>}
            <option value="reported_by_me">Reported by me</option>
            {(technicalRoles.includes(user.role) || user.role === "systems_automation") && <option value="worked_by_me">Worked by me</option>}
          </select>}
        </div>
        <p className="muted">Select a breakdown to review the reported problem, investigation history, prior fixes and unsuccessful attempts.</p>
        <div className="table panel"><table><thead><tr><th>Reference</th><th>Equipment / description</th><th>Reported by</th><th>Problem</th><th>Status</th><th>Section</th></tr></thead><tbody>{faults.map((fault) => <tr key={String(fault.id)} className={selectedId === String(fault.id) ? "selected-row" : "clickable-row"} onClick={() => { setSelectedId(String(fault.id)); setSearchParams({ mode: "history", ...(historyScope ? { scope: historyScope } : {}), fault: String(fault.id) }); }} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") { setSelectedId(String(fault.id)); setSearchParams({ mode: "history", ...(historyScope ? { scope: historyScope } : {}), fault: String(fault.id) }); } }}>
          <td><strong>{String(fault.reference)}</strong></td><td>{String(fault.equipment_tag || "Asset not identified")}{fault.equipment_confirmed === false && <small className="unconfirmed-label">Needs asset confirmation</small>}</td><td>{String(fault.reporter_name || "—")}</td><td>{String(fault.symptom)}</td><td>{String(fault.status)}</td><td>{String(fault.assigned_section || "Unassigned")}</td>
        </tr>)}</tbody></table></div>
        {!faults.length && <div className="empty">No breakdowns match this search.</div>}
        {selectedId && <FaultDetail key={selectedId} user={user} faultId={selectedId} onRefresh={loadFaults} />}
      </>}
    </section>
  );
}
