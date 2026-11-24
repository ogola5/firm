# User Roles and Visibility

This is the prototype's proposed least-privilege model. Role titles and permission boundaries must be confirmed by KPC before production use. All seeded accounts and people are synthetic.

## Maintenance section roles

Section technicians and engineers are assigned to Electrical, Instrumentation or Mechanical; Systems Automation has cross-section access to the first-response queue. Systems Automation receives the first assignment for every new breakdown, and responders can read findings and history from sections already involved in that same fault.

| Level | Role | Default access |
|---|---|---|
| ST | Senior Technician | Shared ST/PT execution pool: read assigned-section work, equipment history and approved procedures; acknowledge jobs; record diagnoses, tests, interventions and procedure contributions; request technical completion review |
| PT | Principal Technician | Same operational investigation and completion-request permissions as ST; shares the section assignment pool |
| CT | Chief Technician | Section-level technical supervisor: see the whole section workload and linked escalations, assign/reassign ST/PT work, set priority and response targets, maintain competencies, review escalations and approve or return technical completion requests; also performs technical review of procedure updates |
| AE | Assistant Engineer | Read section fault history and approved procedures; update investigation and contribute diagnoses, interventions and procedure updates |
| ENG | Engineer | AE access and procedure contributions |
| Senior Engineer | Senior Engineer | Engineer access plus restoration authority |
| Chief Engineer | Chief Engineer | Senior Engineer access plus section-only technical review |

ST/PT assignments remain one operational pool; the Chief Technician coordinates the section rather than acting as another assigned investigator. Each section's Chief Technician controls assignments and reviews that section's escalation requests. An approved escalation creates the next linked section assignment without replacing the original fault record. A technician records successful corrective work and requests technical completion; the responsible section Chief Technician approves or returns that request. Operations separately confirms service restoration before a fault is closed. An Operations rejection reopens work with the last responsible section.

Fault investigation records preserve multiple possible causes and every intervention, including unsuccessful attempts. Successful intervention evidence is required before a procedure update can be submitted. Revisions create new immutable versions; prior versions and review comments remain available.

## Cross-section and corporate roles

| Role | What they can see/do | Restrictions |
|---|---|---|
| Operations | Equipment identification, fault reporting, progress updates, evidence and restoration confirmation across stations | No account administration, maintenance approvals or HR directory |
| Systems Automation | First responder for all breakdowns; cross-section triage, asset confirmation, prior fault context and accountable section handoffs | Cannot administer accounts or publish procedure updates |
| Maintenance Manager | Detailed maintenance records, workflow analytics and approved procedures across sections | No account provisioning or procedure publication approval |
| HR Officer | Synthetic employee directory; date-filtered contribution evidence: authored/approved procedures, colleague-confirmed reuse, diagnoses, intervention outcomes and response/restoration times | No individual fault narratives, equipment records or procedure contents; report counts are contextual and not rewarded |
| General Manager, Operations & Maintenance | Cross-section Operations → Systems Automation → section handoff funnel, assignment ownership and timing baselines, repeat-fault context, knowledge reuse and maintenance records | Workforce view is aggregate only; no HR directory or account administration |
| Managing Director / CEO | Enterprise summary KPIs and resolved rate | No individual fault, equipment, maintenance-evidence or employee records |
| Supervisor | Maintenance records; final publication approval after Chief Technician/Chief Engineer technical review | No account provisioning; cannot bypass technical review for publication |
| System Administrator | Role definitions, account provisioning/deactivation and technical system access | Cannot approve maintenance knowledge or safety/operational work |

## Procedure contribution, review and reuse

1. Technicians and engineers open a fault to see same-equipment history, prior diagnoses, failed and successful interventions, and applicable approved procedures.
2. They record diagnoses and each intervention with contributor and timestamp. An unsuccessful attempt remains visible.
3. After a successful intervention and approved technical completion, the contributor submits a procedure update.
4. The section Chief Technician or Chief Engineer reviews the technical evidence, approves the review or asks for clarification. The contributor revises by creating a new version.
5. A Supervisor publishes a technically reviewed version to the reusable library. Drafts, clarification requests and technical approvals are not published.
6. A colleague records procedure reuse on a fault and confirms success or failure after restoration. Only colleague-confirmed successful reuse counts as reuse evidence for the procedure contributor.

HR evidence is date-filterable and explicitly illustrative. Recognition points in the prototype are a demonstration weighting (10 per approved procedure, 2 additional per approved revision, 5 per colleague-confirmed successful reuse), not an approved KPC appraisal score. Response/restoration durations use fault and event timestamps and should be interpreted with role, case and workload context. Fault-report volume does not earn points.

GM workflow analytics are based on recorded handoff events and show baselines; they do not claim downtime savings without a measured baseline and comparable operating periods.

## Repeat-fault and recognition workflow

- Operations reporting flags a same-equipment/same-symptom fault seen in the previous 90 days.
- Repeat-fault history is surfaced to responders, but every repeat still starts with Systems Automation. Each section Chief reviews its incoming work, and any subsequent section receives the prior findings, tests, evidence and recommended next action when the escalation is approved.
- Troubleshooting ranks multiple diagnoses using confirmed successes, failed attempts, quick checks and recurrence warnings.
- Recurring workaround fixes are flagged for deeper investigation. Caution/High-risk fixes require supervisor approval.
- Contributor recognition uses approved procedures, meaningful revisions and colleague-confirmed reuse. Report volume does not earn recognition points.
- The recognition model is locally illustrative and structured as an SOCA-compatible future integration; no external SOCA or SAP connection is active.

## Legacy work instructions

Legacy knowledge is separate from fault-derived digital procedures. It preserves existing and old operating or maintenance work instructions for equipment and tools that still function. An instruction record contains the legacy document/reference, equipment or tool scope, numbered step-by-step actions, normal checks, corrective actions and safety notes.

Technicians and engineers may digitize or submit legacy instructions. New legacy submissions enter a review state; supervisors or maintenance reviewers approve or reject them. Approved legacy instructions remain readable and usable without requiring a new fault to be reported. Legacy instructions must not be converted into or mixed with fault-based knowledge solely because they share the same symptom.

## Account administration

Only a System Administrator can create accounts, assign roles/sections, or activate/deactivate accounts. These actions are recorded in an administrator-only audit log. HR has a read-only people directory. The General Manager sees counts only. Passwords are hashed; the directory API never returns password hashes.

## Demo account naming

The login selector loads synthetic accounts from `/api/v1/auth/demo-accounts`. Section account usernames follow `<level>-<section>`, for example `st-electrical`, `chief-engineer-mechanical` or `ct-systems-automation`. All seeded demo accounts use `demo123`. Do not reuse these credentials.
