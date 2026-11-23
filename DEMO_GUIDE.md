# Demonstration Guide

All data and identities are illustrative.

| Role | Username | Password |
|---|---|---|
| Operations | operations | demo123 |
| Systems Automation | automation | demo123 |
| Senior Technician | st-electrical | demo123 |
| Principal Technician | pt-electrical | demo123 |
| Chief Technician | ct-electrical | demo123 |
| Assistant Engineer | assistant-engineer-electrical | demo123 |
| Engineer | engineer-electrical | demo123 |
| Senior Engineer | senior-engineer-electrical | demo123 |
| Chief Engineer | chief-engineer-electrical | demo123 |
| HR Officer | hr | demo123 |
| Maintenance Manager | maintenance-manager | demo123 |
| General Manager, Operations & Maintenance | gm-om | demo123 |
| Managing Director / CEO | ceo | demo123 |
| Supervisor | supervisor | demo123 |
| System Administrator | admin | demo123 |

Technician and engineer accounts are seeded for each section: Systems Automation, Electrical, Instrumentation and Mechanical. In the login selector, select the section and level. The usernames above are Electrical examples.

See [ROLE_ACCESS_MATRIX.md](ROLE_ACCESS_MATRIX.md) for role scope and visibility rules.

## Guided sequence

1. Sign in as `operations` and report a fault.
2. Sign in as `automation` and assign it to the appropriate section.
3. Sign in as `st-electrical` and acknowledge the fault.
4. Open a fault in the section account. Review same-equipment history, possible causes, failed/successful interventions and approved procedures before repeating work.
5. Record a diagnosis and more than one intervention, including a failed attempt if applicable. Restore the fault after a successful intervention.
6. Submit a reusable work-procedure update. Sign in as `ct-electrical` or `chief-engineer-electrical` to approve the technical review or request clarification. As the contributing account, revise after a clarification request.
7. Sign in as `supervisor` to inspect the technically approved queue and publish an update. It then appears in the approved library.
8. Reopen another repeat fault as a section technician, record procedure reuse, and confirm whether it helped after restoration.
9. Sign in as `hr` to filter contribution evidence by date and review approved procedures, colleague-confirmed reuse, intervention outcomes and response/restoration durations. Fault narratives remain restricted; the prototype weighting is illustrative only.
10. Sign in as `gm-om` to review Operations → Systems Automation → maintenance-section handoffs, wrong first assignments, repeat-fault routing and timing baselines. These synthetic baselines do not claim downtime savings.
11. Sign in as `ceo` to review summary-only KPIs; individual fault records are restricted.
12. Disconnect the network and submit another fault; it is queued locally. Restore connectivity and press **Sync now**.
13. Select an equipment and symptom with prior history in Operations: the report screen should show a Seen Before alert and direct routing to the equipment-owning standby section.
14. Record ranked troubleshooting causes with a quick check, fix summary, workaround flag and risk level.
15. Open GM O&M to see report-to-triage, triage-to-acknowledge, acknowledge-to-diagnose, diagnose-to-restoration and restoration-to-close median minutes.
16. Open the recognition leaderboard. It is an illustrative SOCA-compatible model, not an external SOCA or SAP integration.
