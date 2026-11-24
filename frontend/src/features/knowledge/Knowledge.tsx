import { Search } from "lucide-react";
import React, { useEffect, useState } from "react";
import { type User } from "../../auth";
import { db } from "../../db";
import { type DataRow } from "../../lib/types";
import { api } from "../../offline/api";

export function Knowledge({ user }: { user: User }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    symptom: "",
    confirmed_cause: "",
    diagnostic_procedure: "",
    corrective_action: "",
    safety: "",
    usage_scope: "",
    legacy_reference: "",
    step_by_step: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api(`/api/v1/knowledge?search=${encodeURIComponent(search)}${sourceFilter === "LEGACY_PROCEDURE" ? "&source_type=LEGACY_PROCEDURE" : sourceFilter === "FAULT_DERIVED" ? "&source_type=FAULT_DERIVED" : ""}`),
      api("/api/v1/procedure-updates/library"),
    ]).then(async ([legacy, procedures]) => {
      const procedureEntries = (procedures as DataRow[]).map((item) => ({
        ...item,
        source_type: "Work procedure",
        symptom: item.observed_symptom,
      }));
      const legacyEntries = (legacy as DataRow[]).map((item) => ({
        ...item,
        source_type: item.source_type === "LEGACY_PROCEDURE" ? "LEGACY_PROCEDURE" : "FAULT_DERIVED",
      }));
      setItems([
        ...(sourceFilter === "ALL" || sourceFilter === "FAULT_DERIVED" ? procedureEntries : []),
        ...(sourceFilter === "ALL" || sourceFilter === "LEGACY_PROCEDURE" || sourceFilter === "FAULT_DERIVED" ? legacyEntries : []),
      ]);
      await db.knowledge.clear();
      await db.knowledge.bulkPut(legacy as never[]);
    }).catch(async () => {
      const cached = await db.knowledge.filter((entry) => entry.status === "APPROVED").toArray();
      setItems(cached.filter((entry) => !search || `${entry.title} ${entry.symptom} ${entry.confirmed_cause}`.toLowerCase().includes(search.toLowerCase())).map((entry) => ({ ...entry, source_type: "Knowledge entry" })));
    });
  }, [search, sourceFilter, user.role, user.section]);

  async function createLegacyProcedure(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await api("/api/v1/knowledge", {
        method: "POST",
        body: JSON.stringify({
          ...createForm,
          source_type: "LEGACY_PROCEDURE",
          instruction_type: "Legacy operating work instruction",
          equipment_id: null,
          confirmed_cause: createForm.confirmed_cause || "Existing equipment/tool operating instruction",
        }),
      });
      setCreateForm({
        title: "", symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "",
        safety: "", usage_scope: "", legacy_reference: "", step_by_step: "",
      });
      setMessage("Legacy work instruction submitted for review.");
      setShowCreate(false);
      setSourceFilter("LEGACY_PROCEDURE");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Legacy work instruction could not be submitted.");
    }
  }
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">MAINTENANCE KNOWLEDGE</p><h2>Approved procedures and knowledge</h2><p className="muted">Only approved and published entries appear in the reusable library.</p></div></div>
      <div className="knowledge-toolbar">
        <div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symptom, cause or legacy reference" /></div>
        <div className="source-tabs" aria-label="Knowledge source">
          {["ALL", "LEGACY_PROCEDURE", "FAULT_DERIVED"].map((source) => <button key={source} className={sourceFilter === source ? "source-tab active" : "source-tab"} onClick={() => setSourceFilter(source)}>{source === "ALL" ? "All records" : source === "LEGACY_PROCEDURE" ? "Legacy work instructions" : "Fault-derived procedures"}</button>)}
        </div>
        {(user.permissions || []).includes("knowledge.contribute") && <button className="secondary" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "Add legacy instruction"}</button>}
      </div>
      {message && <p className="confirmation">{message}</p>}
      {error && <p className="error">{error}</p>}
      {showCreate && <form className="panel legacy-create" onSubmit={createLegacyProcedure}>
        <div className="page-heading"><div><p className="eyebrow">LEGACY / EXISTING EQUIPMENT</p><h3>Add step-by-step work instruction</h3></div></div>
        <div className="form-grid">
          <label>Instruction title<input value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} required /></label>
          <label>Legacy reference<input value={createForm.legacy_reference} onChange={(event) => setCreateForm({ ...createForm, legacy_reference: event.target.value })} placeholder="Document, tool or manual reference" /></label>
          <label>Equipment / tool scope<input value={createForm.usage_scope} onChange={(event) => setCreateForm({ ...createForm, usage_scope: event.target.value })} placeholder="Tag, model or work area" /></label>
        </div>
        <label>Operating or maintenance purpose<input value={createForm.symptom} onChange={(event) => setCreateForm({ ...createForm, symptom: event.target.value })} placeholder="What this instruction enables or maintains" /></label>
        <label>Step-by-step instructions<textarea value={createForm.step_by_step} onChange={(event) => setCreateForm({ ...createForm, step_by_step: event.target.value })} placeholder={"1. Verify permit and isolation.\n2. Inspect the equipment or tool.\n3. Perform the approved work.\n4. Record checks and restore safely."} required /></label>
        <div className="form-grid">
          <label>Diagnostic / normal checks<textarea value={createForm.diagnostic_procedure} onChange={(event) => setCreateForm({ ...createForm, diagnostic_procedure: event.target.value })} /></label>
          <label>Corrective action<textarea value={createForm.corrective_action} onChange={(event) => setCreateForm({ ...createForm, corrective_action: event.target.value })} /></label>
          <label>Safety requirements<textarea value={createForm.safety} onChange={(event) => setCreateForm({ ...createForm, safety: event.target.value })} /></label>
        </div>
        <button className="primary" type="submit">Submit legacy instruction</button>
      </form>}
      <div className="knowledge-grid">{items.map((item) => {
        const isLegacy = item.source_type === "LEGACY_PROCEDURE";
        const steps = String(item.step_by_step || "").split("\n").filter((step) => step.trim());
        return <article className={`knowledge-card ${isLegacy ? "legacy-card" : "fault-card"}`} key={`${String(item.source_type)}-${String(item.id)}`}>
          <div className="card-top"><span className="source-badge">{isLegacy ? "LEGACY WORK INSTRUCTION" : "FAULT-DERIVED PROCEDURE"}</span><small>{String(item.reference)} · v{String(item.version)}</small></div>
          {isLegacy && <><p className="legacy-meta"><strong>Legacy reference:</strong> {String(item.legacy_reference || "Not recorded")}<br /><strong>Applies to:</strong> {String(item.usage_scope || "Defined operating scope")}</p>
            {steps.length ? <ol className="instruction-steps">{steps.map((step, index) => <li key={index}>{step.replace(/^\d+\.\s*/, "")}</li>)}</ol> : <p className="muted">Step-by-step text has not been migrated.</p>}
          </>}
          {!isLegacy && <><h3>{String(item.title)}</h3><p><strong>Symptom:</strong> {String(item.symptom)}</p><p><strong>Cause:</strong> {String(item.confirmed_cause)}</p><p><strong>Diagnostic procedure:</strong> {String(item.diagnostic_procedure || "See linked fault history")}</p><p><strong>Action:</strong> {String(item.corrective_action)}</p>{Boolean(item.author_name) && <p><strong>Contributor:</strong> {String(item.author_name)}</p>}</>}
          {isLegacy && <div className="legacy-footer"><span className="status approved">{String(item.status)}</span><small>{String(item.instruction_type || "Legacy work instruction")}</small></div>}
        </article>;
      })}</div>
      {!items.length && <div className="empty">No approved knowledge matches this search.</div>}
    </section>
  );
}
