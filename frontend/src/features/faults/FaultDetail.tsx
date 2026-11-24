import { CloudOff } from "lucide-react";
import React, { useEffect, useState } from "react";
import { type User } from "../../auth";
import { db } from "../../db";
import { dateTimeLocal } from "../../lib/format";
import { OFFLINE_SAVED } from "../../lib/messages";
import { type DataRow, type FaultContext } from "../../lib/types";
import { API_BASE as API, ApiError, api, isOfflineError } from "../../offline/api";
import { cacheFaultContext, cachedFaultContext } from "../../offline/cache";
import { networkFetch } from "../../offline/network";
import { queueDiagnosis, queueFaultAction, queueIntervention, queueOperatorUpdate } from "../../offline/outbox";

export function FaultDetail({ user, faultId, onRefresh }: { user: User; faultId: string; onRefresh: () => Promise<void> }) {
  const [context, setContext] = useState<FaultContext | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [diagnosis, setDiagnosis] = useState({ possible_cause: "", diagnostic_method: "", observations: "", test_results: "", confidence: "", quick_check: "", fix_summary: "", workaround: false, risk_level: "Normal" });
  const [intervention, setIntervention] = useState({ diagnosis_id: "", corrective_action: "", tools_materials: "", outcome: "SUCCESS", notes: "" });
  const [procedure, setProcedure] = useState({ title: "", observed_symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "", safety: "" });
  const [triageSection, setTriageSection] = useState("");
  const [triageComment, setTriageComment] = useState("");
  const [triageAssetSearch, setTriageAssetSearch] = useState("");
  const [triageAssets, setTriageAssets] = useState<DataRow[]>([]);
  const [confirmedEquipmentId, setConfirmedEquipmentId] = useState("");
  const [revisionOf, setRevisionOf] = useState("");
  const [handoffSection, setHandoffSection] = useState("");
  const [handoffFindings, setHandoffFindings] = useState("");
  const [handoffRecommendation, setHandoffRecommendation] = useState("");
  const [technicianPool, setTechnicianPool] = useState<DataRow[]>([]);
  const [allocation, setAllocation] = useState({ assigned_user_id: "", severity: "Medium", response_due_at: "", instructions: "" });
  const [reviewComments, setReviewComments] = useState("");
  const [operatorNote, setOperatorNote] = useState("");
  const [operatorComments, setOperatorComments] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const isSectionChief = user.role === "technician_ct";
  const canUpdateFault = (user.permissions || []).includes("faults.update");
  const canInvestigate = ["systems_automation", "technician_st", "technician_pt", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role);
  const canContribute = (user.permissions || []).includes("knowledge.contribute");
  const canTriage = (user.permissions || []).includes("faults.triage") || (user.permissions || []).includes("faults.triage.section");

  const [offlineView, setOfflineView] = useState(false);

  async function reload() {
    let loaded: FaultContext;
    try {
      loaded = await api(`/api/v1/faults/${encodeURIComponent(faultId)}/context`) as FaultContext;
      await cacheFaultContext(faultId, loaded as unknown as Record<string, unknown>);
      setOfflineView(false);
    } catch (reason) {
      const cached = isOfflineError(reason) || (reason instanceof ApiError && reason.status === 404)
        ? await cachedFaultContext(faultId)
        : undefined;
      if (!cached) {
        const summary = await db.faults.get(faultId);
        if (summary?.offline_pending) {
          // Reported on this device and not yet on the server.
          setContext({
            fault: summary, assignments: [], attachments: [], operator_updates: [], timeline: [], diagnoses: [],
            interventions: [], previous_faults: [], approved_procedures: [], legacy_knowledge: [], procedure_updates: [], reuse_records: [],
          } as unknown as FaultContext);
          setOfflineView(true);
          return;
        }
        throw isOfflineError(reason)
          ? new Error("This breakdown was not opened while connected, so its investigation is not on this device yet.")
          : reason;
      }
      loaded = cached.context as unknown as FaultContext;
      setOfflineView(true);
    }
    setContext(loaded);
    setTriageSection((current) => current || String(loaded.fault.assigned_section || loaded.fault.suggested_section || ""));
    const active = loaded.assignments.find((item) => Boolean(item.is_active));
    setAllocation({
      assigned_user_id: String(active?.assigned_user_id || ""),
      severity: String(loaded.fault.severity || "Medium"),
      response_due_at: dateTimeLocal(active?.response_due_at),
      instructions: String(active?.instructions || ""),
    });
  }

  useEffect(() => {
    reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Investigation history could not be loaded."));
  }, [faultId]);

  useEffect(() => {
    if (isSectionChief) {
      api("/api/v1/chief/team").then(setTechnicianPool).catch((reason) => setError(reason instanceof Error ? reason.message : "Section technician pool could not be loaded."));
    }
  }, [isSectionChief, user.section]);

  useEffect(() => {
    const query = triageAssetSearch.trim();
    if (query.length < 2) {
      setTriageAssets([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api(`/api/v1/equipment?search=${encodeURIComponent(query)}`)
        .then((items) => { if (active) setTriageAssets(items); })
        .catch(() => { if (active) setTriageAssets([]); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [triageAssetSearch]);

  async function performAction(action: string) {
    setError("");
    setMessage("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/action?action=${action}`, { method: "POST" });
      setMessage(`Fault ${action.replace("_", " ")} recorded.`);
      await reload();
      await onRefresh();
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueFaultAction(user.id, faultId, action);
        setMessage(`${action.replace("_", " ")}: ${OFFLINE_SAVED}`);
        await reload();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Fault action failed.");
    }
  }

  async function submitDiagnosis(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const body = { ...diagnosis, confidence: diagnosis.confidence ? Number(diagnosis.confidence) : null };
    const clear = () => setDiagnosis({ possible_cause: "", diagnostic_method: "", observations: "", test_results: "", confidence: "", quick_check: "", fix_summary: "", workaround: false, risk_level: "Normal" });
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/diagnoses`, { method: "POST", body: JSON.stringify(body) });
      clear();
      setMessage("Diagnosis recorded. It remains unverified until an intervention confirms it.");
      await reload();
      await onRefresh();
    } catch (reason) {
      if (isOfflineError(reason)) {
        if (!body.possible_cause.trim() || !body.diagnostic_method.trim()) {
          setError("A possible cause and diagnostic method are required.");
          return;
        }
        await queueDiagnosis(user, faultId, body);
        clear();
        setMessage(`Diagnosis: ${OFFLINE_SAVED}`);
        await reload();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Diagnosis could not be saved.");
    }
  }

  async function submitIntervention(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const body = { ...intervention, diagnosis_id: intervention.diagnosis_id || null };
    const clear = () => setIntervention({ diagnosis_id: "", corrective_action: "", tools_materials: "", outcome: "SUCCESS", notes: "" });
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/interventions`, { method: "POST", body: JSON.stringify(body) });
      clear();
      setMessage("Intervention recorded; failed attempts remain in the history.");
      await reload();
    } catch (reason) {
      if (isOfflineError(reason)) {
        if (!body.corrective_action.trim()) {
          setError("A corrective action is required.");
          return;
        }
        await queueIntervention(user, faultId, body);
        clear();
        setMessage(`Intervention: ${OFFLINE_SAVED} Failed attempts are kept.`);
        await reload();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Intervention could not be saved.");
    }
  }

  async function submitProcedure(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const path = revisionOf
        ? `/api/v1/procedure-updates/${encodeURIComponent(revisionOf)}/revisions`
        : `/api/v1/faults/${encodeURIComponent(faultId)}/procedure-updates`;
      await api(path, { method: "POST", body: JSON.stringify(procedure) });
      setProcedure({ title: "", observed_symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "", safety: "" });
      setRevisionOf("");
      setMessage(revisionOf ? "A new immutable procedure version has been submitted." : "Work-procedure update submitted for chief technical review.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Work-procedure update could not be submitted.");
    }
  }

  async function reuseProcedure(procedureUpdateId: string) {
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/procedure-reuse`, {
        method: "POST",
        body: JSON.stringify({ procedure_update_id: procedureUpdateId }),
      });
      setMessage("Procedure use recorded. Confirm whether it helped after restoring the fault.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Procedure reuse could not be recorded.");
    }
  }

  async function confirmReuse(reuseId: string, outcome: string) {
    setError("");
    try {
      await api(`/api/v1/procedure-reuse/${encodeURIComponent(reuseId)}/outcome`, {
        method: "POST",
        body: JSON.stringify({ outcome }),
      });
      setMessage(`Procedure reuse confirmed as ${outcome.toLowerCase()}.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Procedure outcome could not be confirmed.");
    }
  }

  async function submitTriage(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/triage`, {
        method: "POST",
        body: JSON.stringify({
          assigned_section: triageSection || String(context?.fault.suggested_section || ""),
          triage_comment: triageComment,
          ...(confirmedEquipmentId ? { confirmed_equipment_id: confirmedEquipmentId } : {}),
        }),
      });
      setMessage(fault.equipment_confirmed === false ? "Asset confirmation recorded; the breakdown remains with Systems Automation." : "Asset confirmation note recorded.");
      setTriageComment("");
      setConfirmedEquipmentId("");
      setTriageAssetSearch("");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Triage could not be saved.");
    }
  }

  async function submitEscalation(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/escalate`, {
        method: "POST",
        body: JSON.stringify({
          next_section: handoffSection,
          findings: handoffFindings,
          recommendation: handoffRecommendation,
        }),
      });
      setHandoffSection("");
      setHandoffFindings("");
      setHandoffRecommendation("");
      setMessage(`Findings handed to ${handoffSection}; the breakdown record remains continuous.`);
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Section handoff could not be saved.");
    }
  }

  async function saveAllocation(event: React.FormEvent) {
    event.preventDefault();
    const assignment = context?.assignments.find((item) => Boolean(item.is_active));
    if (!assignment) return;
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/allocate`, {
        method: "POST",
        body: JSON.stringify({
          ...allocation,
          assigned_user_id: allocation.assigned_user_id || null,
          response_due_at: allocation.response_due_at ? new Date(allocation.response_due_at).toISOString() : null,
        }),
      });
      setMessage("Section assignment and response target saved.");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Section assignment could not be saved.");
    }
  }

  async function reviewSectionWork(decision: string) {
    const assignment = context?.assignments.find((item) => Boolean(item.is_active));
    if (!assignment) return;
    if (decision.startsWith("RETURN_") && !reviewComments.trim()) {
      setError("Add clear instructions before returning work for more investigation.");
      return;
    }
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, comments: reviewComments }),
      });
      setReviewComments("");
      setMessage(decision.startsWith("APPROVE_") ? "Chief technical review approved." : "Work returned with your instructions.");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Technical review could not be saved.");
    }
  }

  async function submitOperatorUpdate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/operator-updates`, {
        method: "POST",
        body: JSON.stringify({ note: operatorNote }),
      });
      setOperatorNote("");
      setMessage("Progress update sent to the responding teams.");
      await reload();
    } catch (reason) {
      if (isOfflineError(reason) && operatorNote.trim()) {
        await queueOperatorUpdate(user, faultId, operatorNote.trim());
        setOperatorNote("");
        setMessage(`Progress update: ${OFFLINE_SAVED}`);
        await reload();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Operator update could not be saved.");
    }
  }

  async function confirmRestoration(confirmed: boolean) {
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/operator-confirmation`, {
        method: "POST",
        body: JSON.stringify({ confirmed, comments: operatorComments }),
      });
      setOperatorComments("");
      setMessage(confirmed ? "Operational restoration confirmed; the breakdown is closed." : "Restoration not confirmed; work has returned to the responsible section.");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operator confirmation could not be saved.");
    }
  }

  async function uploadEvidence() {
    setError("");
    const failed: string[] = [];
    const failedFiles: File[] = [];
    for (const file of evidenceFiles) {
      const form = new FormData();
      form.append("file", file);
      try {
        await api(`/api/v1/faults/${encodeURIComponent(faultId)}/attachments`, { method: "POST", body: form });
      } catch (reason) {
        failedFiles.push(file);
        failed.push(`${file.name}: ${reason instanceof Error ? reason.message : "upload failed"}`);
      }
    }
    setEvidenceFiles(failedFiles);
    if (failed.length) {
      setError(`Evidence could not be uploaded: ${failed.join(", ")}.`);
    } else {
      setMessage("Evidence added to this breakdown.");
    }
    await reload();
  }

  async function downloadEvidence(attachmentId: string, filename: string) {
    setError("");
    try {
      const token = localStorage.getItem("kpc-token");
      const response = await networkFetch(`${API}/api/v1/faults/${encodeURIComponent(faultId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(await response.text());
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Evidence could not be downloaded.");
    }
  }

  if (!context) return <div className="panel"><h3>Fault work history</h3>{error ? <p className="error">{error}</p> : <p className="muted">Loading fault history…</p>}</div>;
  const fault = context.fault;
  const statusValue = String(fault.status);
  const activeAssignment = context.assignments.find((item) => Boolean(item.is_active));
  const canWorkAssignment = !isSectionChief && Boolean(activeAssignment) && (
    user.role === "systems_automation"
      ? activeAssignment?.section === "Systems Automation"
      : canInvestigate
        ? activeAssignment?.section === user.section
        : true
  );
  const canReviewSectionAssignment = isSectionChief && activeAssignment?.section === user.section;
  const awaitingChiefReview = statusValue === "AWAITING_CHIEF_REVIEW"
    || activeAssignment?.escalation_status === "PENDING"
    || activeAssignment?.completion_review_status === "PENDING";
  const canTriageCurrent = canTriage && (
    !activeAssignment || (
      activeAssignment.section === "Systems Automation"
      && ["systems_automation", "maintenance_manager", "supervisor", "system_administrator"].includes(user.role)
    )
  );
  const canConfirmRestoration = user.role === "operations" && (user.permissions || []).includes("faults.confirm");
  const canAttachEvidence = user.role === "operations" || canWorkAssignment
    || ["maintenance_manager", "general_manager_om", "supervisor", "system_administrator"].includes(user.role);
  const hasSuccessfulIntervention = context.interventions.some((item) => item.outcome === "SUCCESS");
  const canSubmitProcedure = canContribute && ["RESTORED", "CLOSED"].includes(statusValue) && hasSuccessfulIntervention;
  const updateActions = user.permissions || [];
  const restrictedTriage = ["technician_ct", "chief_engineer"].includes(user.role);
  const allSections = ["Systems Automation", "Electrical", "Instrumentation", "Mechanical"];
  const triageOptions = (activeAssignment?.section === "Systems Automation" ? ["Systems Automation"] : allSections).filter((section) => {
    if (!restrictedTriage) return true;
    if (context?.fault.equipment_confirmed === false && !confirmedEquipmentId && section === "Systems Automation") return true;
    return section === user.section;
  });
  const unresolvedReuse = context.reuse_records.filter((item) => item.actor_id === user.id && !item.outcome);

  return (
    <div className="fault-detail">
      {offlineView && (
        <div className="offline-banner" role="status">
          <CloudOff size={16} />
          {fault.offline_pending
            ? "Reported on this device and waiting to synchronise. Investigation steps become available once Systems Automation receives it."
            : "Offline: this is the copy saved on this device. Acknowledge, on-site, diagnosis, intervention and operator updates are queued; other steps need a connection."}
        </div>
      )}
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">WORK ORDER CONTEXT</p><h3>{String(fault.reference)} · {String(fault.equipment_tag)}</h3><p>{String(fault.symptom)} · {String(fault.description || "No additional report details")}</p>{Boolean(fault.operating_conditions) && <p><strong>Operating conditions:</strong> {String(fault.operating_conditions)}</p>}{Boolean(fault.operational_impact) && <p><strong>Operational effect:</strong> {String(fault.operational_impact)}</p>}</div><span className="status">{statusValue}</span></div>
        <p className="muted">Assigned section: {String(fault.assigned_section || "Unassigned")} · Reported by {String(fault.reporter_name || "Unknown")} · {new Date(String(fault.created_at)).toLocaleString()}{fault.reported_on_behalf_of ? ` · On behalf of ${String(fault.reported_on_behalf_of)}` : ""}</p>
        {fault.equipment_confirmed === false && <div className="unconfirmed-banner">
          <strong>Asset not confirmed</strong>
          <span>Reported wording: {String(fault.reported_equipment_text || "Not provided")}{Boolean(fault.reported_location) ? ` · Location: ${String(fault.reported_location)}` : ""}</span>
          {Boolean(fault.suggested_equipment_tag) && <span>Possible match only: {String(fault.suggested_equipment_tag)}</span>}
          <span>Do not use the suggestion as a confirmed tag. Confirm the physical asset before routing to its maintenance section.</span>
        </div>}
        {context.previous_faults.length > 0 && <p className="repeat-alert">Seen before on this equipment: {context.previous_faults.length} earlier report(s). Review the diagnosis and intervention history before repeating work.</p>}
        {canTriageCurrent && <form className="triage-form" onSubmit={submitTriage}>
          <strong>Systems Automation asset confirmation</strong><span className="muted">{fault.equipment_confirmed === false ? "Confirm the actual equipment before any section handoff." : `Suggested owner section: ${String(fault.suggested_section || "Not set")}. This breakdown remains with Systems Automation until findings are handed off.`}</span>
          {fault.equipment_confirmed === false && <label>Find the actual equipment by tag or description
            <input value={triageAssetSearch} onChange={(event) => { setTriageAssetSearch(event.target.value); setConfirmedEquipmentId(""); }} placeholder="Search equipment records" />
          </label>}
          {fault.equipment_confirmed === false && triageAssets.slice(0, 5).map((item) => <button type="button" className={`asset-match ${confirmedEquipmentId === String(item.id) ? "selected" : ""}`} key={String(item.id)} onClick={() => { setConfirmedEquipmentId(String(item.id)); setTriageSection("Systems Automation"); }}>
            <span><strong>{String(item.tag)} · {String(item.name)}</strong><small>{String(item.location)} · {String(item.section)}</small></span><span className="tag">{confirmedEquipmentId === String(item.id) ? "Confirmed asset" : "Select actual asset"}</span>
          </button>)}
          <div className="form-grid"><label>Current section<select value={triageSection || String(fault.assigned_section || "Systems Automation")} onChange={(event) => setTriageSection(event.target.value)} required>{triageOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label><label>Asset confirmation note<input value={triageComment} onChange={(event) => setTriageComment(event.target.value)} /></label></div>
          <button className="secondary" type="submit">{fault.equipment_confirmed === false ? confirmedEquipmentId ? "Confirm asset; keep with Systems Automation" : "Keep unconfirmed with Systems Automation" : "Save asset confirmation"}</button>
        </form>}
        {canUpdateFault && canWorkAssignment && fault.equipment_confirmed !== false && <div className="action-row">
          {["REPORTED", "TRIAGED", "ASSIGNED"].includes(statusValue) && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("acknowledge")}>Acknowledge</button>}
          {statusValue === "ACKNOWLEDGED" && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("on_site")}>On site</button>}
          {["ON_SITE", "ACKNOWLEDGED"].includes(statusValue) && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("diagnose")}>Mark diagnosed</button>}
          {!["RESTORED", "CLOSED", "AWAITING_CHIEF_REVIEW"].includes(statusValue) && updateActions.includes("faults.restore") && <button className="primary" onClick={() => performAction("restore")}>Request technical completion review</button>}
        </div>}
        {canUpdateFault && fault.equipment_confirmed === false && <p className="muted">Technical actions are disabled until the physical equipment is confirmed.</p>}
        {statusValue === "AWAITING_CHIEF_REVIEW" && <p className="repeat-alert">Work is waiting for Chief Technician review. Operations cannot confirm restoration until technical completion is approved.</p>}
        {statusValue === "RESTORED" && <p className="confirmation">Chief technical review is complete. Waiting for Operations to confirm service restoration.</p>}
        {Boolean(fault.closure_remarks) && <p><strong>Operator closure remarks:</strong> {String(fault.closure_remarks)}</p>}
        {message && <p className="confirmation">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {context.assignments.length > 0 && <div className="panel assignment-chain">
        <div className="section-heading"><div><p className="eyebrow">ACCOUNTABLE SECTION HANDOFFS</p><h3>One breakdown, shared findings</h3></div><span className="muted">Active section: {String(activeAssignment?.section || "Awaiting operator confirmation")}</span></div>
        <div className="assignment-list">{context.assignments.map((item, index) => <article className="assignment-card" key={String(item.id)}>
          <div className="assignment-heading"><strong>{index + 1}. {String(item.section)}</strong><span className={`status ${String(item.status).toLowerCase()}`}>{String(item.status).replace(/_/g, " ")}</span></div>
          <small>{item.assigned_user_name ? `Owner: ${String(item.assigned_user_name)}` : "Awaiting section acknowledgement"} · {new Date(String(item.created_at)).toLocaleString()} · {String(item.elapsed_minutes)} min in assignment</small>
          {Boolean(item.reason) && <p><strong>Handoff reason:</strong> {String(item.reason)}</p>}
          {Boolean(item.instructions) && <p><strong>Chief Technician instructions:</strong> {String(item.instructions)}</p>}
          {Boolean(item.response_due_at) && <p><strong>Expected response:</strong> {new Date(String(item.response_due_at)).toLocaleString()}</p>}
          {Boolean(item.findings) && <p><strong>Findings:</strong> {String(item.findings)}</p>}
          {Boolean(item.recommendation) && <p><strong>Recommended next action:</strong> {String(item.recommendation)}</p>}
          {item.escalation_status === "RETURNED" && Boolean(item.escalation_review_comments) && <p><strong>Chief review:</strong> {String(item.escalation_review_comments)}</p>}
          {item.completion_review_status === "RETURNED" && Boolean(item.completion_review_comments) && <p><strong>Completion review:</strong> {String(item.completion_review_comments)}</p>}
        </article>)}</div>
        {canReviewSectionAssignment && fault.equipment_confirmed !== false && <form className="assignment-allocation" onSubmit={saveAllocation}>
          <h4>Allocate section work</h4>
          <p className="muted">Choose an available Senior or Principal Technician using current workload and their recorded competencies.</p>
          <div className="form-grid">
            <label>Assigned technician<select value={allocation.assigned_user_id} onChange={(event) => setAllocation({ ...allocation, assigned_user_id: event.target.value })}>
              <option value="">Leave in section queue</option>
              {technicianPool.filter((person) => person.active && (
                person.availability_status === "AVAILABLE" || String(person.id) === allocation.assigned_user_id
              )).map((person) => <option key={String(person.id)} value={String(person.id)}>
                {String(person.display_name)} · {String(person.role_label)} · {String(person.active_workload)} active · {((person.competencies || []) as string[]).join(", ") || "Competencies not recorded"}
              </option>)}
            </select></label>
            <label>Operational priority<select value={allocation.severity} onChange={(event) => setAllocation({ ...allocation, severity: event.target.value })}>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Expected response by<input type="datetime-local" value={allocation.response_due_at} onChange={(event) => setAllocation({ ...allocation, response_due_at: event.target.value })} required /></label>
          </div>
          <label>Technical instructions<textarea value={allocation.instructions} onChange={(event) => setAllocation({ ...allocation, instructions: event.target.value })} placeholder="Focus checks, permit constraints, or evidence to collect" /></label>
          <button className="primary" type="submit">{activeAssignment?.assigned_user_id ? "Save assignment / reassign" : "Assign work"}</button>
        </form>}
        {canReviewSectionAssignment && activeAssignment?.escalation_status === "PENDING" && <div className="section-review-panel">
          <h4>Review requested escalation to {String(activeAssignment.requested_next_section)}</h4>
          <p className="muted">Check the technician’s findings, evidence and recommendation above before transferring the next assignment.</p>
          <label>Review note or instructions<textarea value={reviewComments} onChange={(event) => setReviewComments(event.target.value)} placeholder="Required if returning for more investigation" /></label>
          <div className="action-row"><button className="primary" type="button" onClick={() => reviewSectionWork("APPROVE_ESCALATION")}>Approve escalation</button><button className="secondary" type="button" onClick={() => reviewSectionWork("RETURN_ESCALATION")}>Return for investigation</button></div>
        </div>}
        {canReviewSectionAssignment && activeAssignment?.completion_review_status === "PENDING" && <div className="section-review-panel">
          <h4>Review technical completion</h4>
          <p className="muted">Verify that corrective work and test results are documented. Approval marks the section restored; Operations must still confirm service.</p>
          <label>Review note or instructions<textarea value={reviewComments} onChange={(event) => setReviewComments(event.target.value)} placeholder="Required if returning for more work" /></label>
          <div className="action-row"><button className="primary" type="button" onClick={() => reviewSectionWork("APPROVE_COMPLETION")}>Approve technical completion</button><button className="secondary" type="button" onClick={() => reviewSectionWork("RETURN_COMPLETION")}>Return for more work</button></div>
        </div>}
        {canWorkAssignment && !awaitingChiefReview && fault.equipment_confirmed !== false && activeAssignment && <form className="handoff-form" onSubmit={submitEscalation}>
          <h4>Hand off to another section</h4>
          <p className="muted">The receiving team gets this fault, prior section findings, tests, and linked evidence.</p>
          <label>Next section<select value={handoffSection} onChange={(event) => setHandoffSection(event.target.value)} required>
            <option value="">Select section</option>{allSections.filter((section) => section !== activeAssignment.section).map((section) => <option key={section}>{section}</option>)}
          </select></label>
          <label>What did your section find?<textarea value={handoffFindings} onChange={(event) => setHandoffFindings(event.target.value)} required /></label>
          <label>What should the next section do?<textarea value={handoffRecommendation} onChange={(event) => setHandoffRecommendation(event.target.value)} required /></label>
          <button className="secondary" type="submit">Send with findings</button>
        </form>}
      </div>}

      <div className="panel evidence-panel">
        <div className="section-heading"><div><p className="eyebrow">SHARED EVIDENCE AND OPERATIONS UPDATES</p><h3>Progress and evidence</h3></div></div>
        {context.attachments.map((item) => {
          const assignment = context.assignments.find((entry) => entry.id === item.assignment_id);
          return <article className="evidence-item" key={String(item.id)}>
            <div><strong>{String(item.filename)}</strong><small>{String(item.uploaded_by)} · {assignment ? `${String(assignment.section)} section` : "Breakdown report"} · {Math.ceil(Number(item.size_bytes) / 1024)} KiB</small></div>
            <button className="secondary" type="button" onClick={() => downloadEvidence(String(item.id), String(item.filename))}>Download</button>
          </article>;
        })}
        {!context.attachments.length && <p className="muted">No evidence attached yet.</p>}
        {canAttachEvidence && statusValue !== "CLOSED" && <div className="evidence-upload">
          <label>Add images, PDFs, or text/log evidence (10 MiB max per file)<input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log" multiple onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))} /></label>
          {evidenceFiles.length > 0 && <><small>{evidenceFiles.map((file) => file.name).join(", ")}</small><button className="secondary" type="button" onClick={uploadEvidence}>Upload evidence</button></>}
        </div>}
        {user.role === "operations" && statusValue !== "CLOSED" && <form className="operator-update-form" onSubmit={submitOperatorUpdate}>
          <h4>Send an update to the responding teams</h4>
          <label>New operating information<textarea value={operatorNote} onChange={(event) => setOperatorNote(event.target.value)} required placeholder="Add a change in conditions, access, or operational impact" /></label>
          <button className="secondary" type="submit">Send progress update</button>
        </form>}
        {context.operator_updates.map((item) => <article className="timeline-item" key={String(item.id)}>
          <strong>{String(item.event_type).replace(/_/g, " ")}</strong>
          <small>{String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small>
          <p>{String((item.payload as DataRow)?.note || (item.payload as DataRow)?.comments || "No additional comments")}</p>
        </article>)}
        {canConfirmRestoration && statusValue === "RESTORED" && <div className="operator-confirmation">
          <h4>Confirm service restoration</h4>
          <p className="muted">Check the valve or equipment against the applicable operating procedure before closing this breakdown.</p>
          <label>Confirmation notes<textarea value={operatorComments} onChange={(event) => setOperatorComments(event.target.value)} placeholder="Optional confirmation note; required if service is still affected" /></label>
          <div className="action-row">
            <button className="primary" type="button" onClick={() => confirmRestoration(true)}>Confirm restored and close</button>
            <button className="secondary" type="button" onClick={() => confirmRestoration(false)}>Still not working — return to section</button>
          </div>
        </div>}
      </div>

      {context.ranked_causes && context.ranked_causes.length > 0 && <div className="panel ranked-causes">
        <div className="section-heading"><div><p className="eyebrow">RANKED TROUBLESHOOTING</p><h3>Most likely causes and confirmed fixes</h3></div><span className="muted">{context.repeat_routing?.seen_before ? "Repeat history shared with Systems Automation first" : "Systems Automation first response"}</span></div>
        <div className="cause-list">
          {context.ranked_causes.map((cause, index) => <article className={`cause-card ${cause.recurrence_warning ? "workaround-warning" : ""}`} key={String(cause.possible_cause)}>
            <div className="cause-rank">{index + 1}</div>
            <div>
              <strong>{String(cause.possible_cause)}</strong>
              <p><b>Quick check:</b> {String(cause.quick_check || "No quick check recorded")}</p>
              <p><b>Fix:</b> {String(cause.fix || "No fix summary recorded")}</p>
              <div className="cause-metrics"><span>Confirmed {String(cause.confirmed_count || 0)}×</span><span>Failed {String(cause.failed_count || 0)}×</span><span>Recurrences {String(cause.recurrence_count || 0)}</span></div>
              {Boolean(cause.recurrence_warning) && <p className="warning-text">Recurring workaround: deeper investigation is required before this becomes a permanent fix.</p>}
              {Boolean(cause.supervisor_required) && <p className="risk-text">Risk level: {String(cause.risk_level)} — supervisor approval is required for this fix.</p>}
            </div>
          </article>)}
        </div>
      </div>}

      <div className="grid-two">
        <div className="panel"><h3>Reported history on this equipment</h3>
          {context.previous_faults.length ? context.previous_faults.map((item) => <article className="history-item" key={String(item.id)}>
            <strong>{String(item.reference)} · {String(item.status)}</strong><small>{new Date(String(item.created_at)).toLocaleDateString()} · {String(item.symptom)}</small>
            <p>{String(item.description || "No report details")}</p>
            {((item.diagnoses || []) as DataRow[]).map((entry, index) => <p key={`d-${index}`}><strong>Cause:</strong> {String(entry.possible_cause)} · {String(entry.verification_status)}</p>)}
            {((item.interventions || []) as DataRow[]).map((entry, index) => <p key={`i-${index}`} className={entry.outcome === "FAILED" ? "failed-attempt" : ""}><strong>{String(entry.outcome)}:</strong> {String(entry.corrective_action)} {String(entry.notes || "")}</p>)}
          </article>) : <p className="muted">No earlier reports for this equipment.</p>}
        </div>
        <div className="panel"><h3>Approved procedures for this equipment or symptom</h3>
          {context.approved_procedures.length ? context.approved_procedures.map((item) => <article className="history-item" key={String(item.id)}>
            <div className="card-top"><strong>{String(item.reference)} · v{String(item.version)}</strong><span className="status approved">APPROVED</span></div>
            <h4>{String(item.title)}</h4><p><strong>Cause:</strong> {String(item.confirmed_cause)}</p><p><strong>Check:</strong> {String(item.diagnostic_procedure)}</p><p><strong>Action:</strong> {String(item.corrective_action)}</p><small>Contributor: {String(item.author_name)}</small>
            {canInvestigate && <button className="secondary" onClick={() => reuseProcedure(String(item.id))}>Record use on this fault</button>}
          </article>) : <p className="muted">No approved work-procedure updates match this case yet.</p>}
          {context.legacy_knowledge.map((item) => <article className="history-item" key={String(item.id)}>
            <strong>{String(item.reference)} · v{String(item.version)} · approved library entry</strong><h4>{String(item.title)}</h4>
            <p><strong>Cause:</strong> {String(item.confirmed_cause)}</p><p><strong>Action:</strong> {String(item.corrective_action)}</p>
            {item.source_type === "LEGACY_PROCEDURE" && <><p><strong>Legacy reference:</strong> {String(item.legacy_reference || "Not recorded")}</p><p><strong>Applies to:</strong> {String(item.usage_scope || "Existing equipment or tool")}</p><ol className="instruction-steps">{String(item.step_by_step || "").split("\n").filter((step) => String(step).trim()).map((step, index) => <li key={index}>{step.replace(/^\d+\.\s*/, "")}</li>)}</ol></>}
          </article>)}
        </div>
      </div>

      {canInvestigate && canWorkAssignment && !awaitingChiefReview && !["RESTORED", "CLOSED"].includes(statusValue) && <div className="grid-two">
        <form className="panel" onSubmit={submitDiagnosis}>
          <h3>Record possible cause and checks</h3>
          <label>Possible cause<input value={diagnosis.possible_cause} onChange={(event) => setDiagnosis({ ...diagnosis, possible_cause: event.target.value })} required /></label>
          <label>Diagnostic method<input value={diagnosis.diagnostic_method} onChange={(event) => setDiagnosis({ ...diagnosis, diagnostic_method: event.target.value })} required /></label>
          <label>Observations<textarea value={diagnosis.observations} onChange={(event) => setDiagnosis({ ...diagnosis, observations: event.target.value })} /></label>
          <label>Test results<textarea value={diagnosis.test_results} onChange={(event) => setDiagnosis({ ...diagnosis, test_results: event.target.value })} /></label>
          <label>Confidence (0–1)<input type="number" min="0" max="1" step="0.05" value={diagnosis.confidence} onChange={(event) => setDiagnosis({ ...diagnosis, confidence: event.target.value })} /></label>
          <label>Quick check<input value={diagnosis.quick_check} onChange={(event) => setDiagnosis({ ...diagnosis, quick_check: event.target.value })} placeholder="Fast test or verification step" /></label>
          <label>Recommended fix<input value={diagnosis.fix_summary} onChange={(event) => setDiagnosis({ ...diagnosis, fix_summary: event.target.value })} /></label>
          <label>Risk level<select value={diagnosis.risk_level} onChange={(event) => setDiagnosis({ ...diagnosis, risk_level: event.target.value })}><option>Normal</option><option>Caution</option><option>High</option></select></label>
          <label className="checkbox-label"><input type="checkbox" checked={diagnosis.workaround} onChange={(event) => setDiagnosis({ ...diagnosis, workaround: event.target.checked })} /> This is a workaround or temporary reset</label>
          <button className="primary" type="submit">Save diagnosis</button>
        </form>
        <form className="panel" onSubmit={submitIntervention}>
          <h3>Record each intervention</h3>
          <label>Related diagnosis<select value={intervention.diagnosis_id} onChange={(event) => setIntervention({ ...intervention, diagnosis_id: event.target.value })}><option value="">Not linked to a diagnosis</option>{context.diagnoses.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.possible_cause)}</option>)}</select></label>
          <label>Action taken<textarea value={intervention.corrective_action} onChange={(event) => setIntervention({ ...intervention, corrective_action: event.target.value })} required /></label>
          <label>Tools / materials<input value={intervention.tools_materials} onChange={(event) => setIntervention({ ...intervention, tools_materials: event.target.value })} /></label>
          <label>Outcome<select value={intervention.outcome} onChange={(event) => setIntervention({ ...intervention, outcome: event.target.value })}><option value="SUCCESS">Successful</option><option value="FAILED">Failed — retain in history</option><option value="IN_PROGRESS">In progress</option></select></label>
          <label>Notes<textarea value={intervention.notes} onChange={(event) => setIntervention({ ...intervention, notes: event.target.value })} /></label>
          <button className="primary" type="submit">Save intervention</button>
        </form>
      </div>}

      <div className="grid-two">
        <div className="panel"><h3>Investigation and intervention log</h3>
          {context.diagnoses.map((item) => <article className="history-item" key={String(item.id)}><strong>Possible cause: {String(item.possible_cause)}</strong><small>{String(item.assignment_section || "Legacy record")} · {String(item.author_name)} · {String(item.verification_status)} · {new Date(String(item.created_at)).toLocaleString()}</small><p>{String(item.diagnostic_method)}</p><p>{String(item.observations)} {String(item.test_results)}</p></article>)}
          {context.interventions.map((item) => <article className={`history-item ${item.outcome === "FAILED" ? "failed-attempt" : ""}`} key={String(item.id)}><strong>{String(item.outcome)} intervention</strong><small>{String(item.assignment_section || "Legacy record")} · {String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small><p>{String(item.corrective_action)}</p><p>{String(item.tools_materials)} {String(item.notes)}</p></article>)}
          {!context.diagnoses.length && !context.interventions.length && <p className="muted">No investigation steps have been recorded for this report.</p>}
        </div>
        <div className="panel"><h3>Event and review timeline</h3>
          {context.timeline.map((item) => <article className="timeline-item" key={String(item.id)}><strong>{String(item.event_type).replace(/_/g, " ")}</strong><small>{String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small></article>)}
          {context.procedure_updates.map((item) => <article className="history-item" key={String(item.id)}><div className="card-top"><strong>{String(item.reference)} · v{String(item.version)}</strong><span className={`status ${String(item.status).toLowerCase()}`}>{String(item.status).replace(/_/g, " ")}</span></div><p>{String(item.title)} · by {String(item.author_name)}</p>
            {((item.reviews || []) as DataRow[]).map((review, index) => <p key={index}><strong>{String(review.decision).replace(/_/g, " ")}:</strong> {String(review.comments)} <small>— {String(review.reviewer_name)}</small></p>)}
            {canContribute && item.author_id === user.id && ["CLARIFICATION_REQUESTED", "APPROVED"].includes(String(item.status)) && <button className="secondary" onClick={() => {
              setRevisionOf(String(item.id));
              setProcedure({
                title: String(item.title), observed_symptom: String(item.observed_symptom), confirmed_cause: String(item.confirmed_cause),
                diagnostic_procedure: String(item.diagnostic_procedure), corrective_action: String(item.corrective_action), safety: String(item.safety || ""),
              });
            }}>Revise this version</button>}
          </article>)}
        </div>
      </div>

      {canSubmitProcedure && <form className="panel procedure-form" onSubmit={submitProcedure}>
        <h3>{revisionOf ? "Submit a new procedure version" : "Update the reusable work procedure"}</h3>
        {revisionOf && <p className="muted">Editing creates a new version; the prior version and review comments remain in the history.</p>}
        <div className="form-grid">
          <label>Procedure title<input value={procedure.title} onChange={(event) => setProcedure({ ...procedure, title: event.target.value })} required /></label>
          <label>Observed symptom<input value={procedure.observed_symptom} onChange={(event) => setProcedure({ ...procedure, observed_symptom: event.target.value })} required /></label>
          <label>Confirmed cause<input value={procedure.confirmed_cause} onChange={(event) => setProcedure({ ...procedure, confirmed_cause: event.target.value })} required /></label>
        </div>
        <label>Diagnostic procedure<textarea value={procedure.diagnostic_procedure} onChange={(event) => setProcedure({ ...procedure, diagnostic_procedure: event.target.value })} required /></label>
        <label>Corrective action<textarea value={procedure.corrective_action} onChange={(event) => setProcedure({ ...procedure, corrective_action: event.target.value })} required /></label>
        <label>Safety notes<textarea value={procedure.safety} onChange={(event) => setProcedure({ ...procedure, safety: event.target.value })} /></label>
        <button className="primary" type="submit">{revisionOf ? "Submit revision" : "Submit for chief technical review"}</button>
      </form>}

      {context.reuse_records.length > 0 && <div className="panel"><h3>Procedure reuse and outcome confirmation</h3>
        {context.reuse_records.map((item) => <article className="history-item" key={String(item.id)}>
          <strong>{String(item.procedure_reference)} · {String(item.procedure_title)}</strong><small>Used by {String(item.actor_name)} · {new Date(String(item.used_at)).toLocaleString()}</small>
          {item.outcome ? <p>Confirmed {String(item.outcome).toLowerCase()} by colleague.</p> : item.actor_id === user.id && ["RESTORED", "CLOSED"].includes(statusValue) && <div className="action-row"><button className="primary" onClick={() => confirmReuse(String(item.id), "SUCCESS")}>Confirm helpful</button><button className="secondary" onClick={() => confirmReuse(String(item.id), "FAILED")}>Confirm not helpful</button></div>}
        </article>)}
        {unresolvedReuse.length > 0 && !["RESTORED", "CLOSED"].includes(statusValue) && <p className="muted">Confirm whether the referenced procedure helped after the fault is restored.</p>}
      </div>}
    </div>
  );
}
