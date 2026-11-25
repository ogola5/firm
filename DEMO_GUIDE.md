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

## Desk workflow (start here)

Operators report from the control-room desk after seeing a problem on SCADA or on a site walk. Technicians carry no device on site: they print a job card, take notes on it, and write the visit up at their desk afterwards.

1. **Report (control room).** Sign in as `operations`. **Report a fault** asks four things: which equipment (type a tag like `11-MOV-501` or a description like `tank 601 inlet valve`; confirm the best match with **Yes, this one**, or leave it for Systems Automation to identify), where and when it was seen, what is wrong and the effect. Paste a SCADA screenshot with Ctrl+V. Priority follows from the effect.
2. **Route.** As `automation`, acknowledge and hand the findings to Electrical; as `ct-systems-automation`, approve; as `ct-electrical`, allocate it to `st-electrical`.
3. **Take the job and print the card.** As `st-electrical`, **My jobs** lists it under *Assigned to you*. Click **I'm taking this job**, then **Print job card**: one A4 sheet with the problem, what worked and failed last time, and note lines in the same order as the write-up screen.
4. **Write up the visit.** Under *To write up*, click **Write up visit**. Enter the arrival and back-in-service times from the notes (they are recorded as the times things happened), what you found (tap a cause found before, or type one), and each thing you did marked **Worked**, **Didn't work** or **Partly**. **Save and ask Chief to sign off**.
5. **Sign-off and confirmation.** As `ct-electrical`, approve technical completion; the restoration time is the one the technician entered. As `operations`, confirm the service is restored.
6. **Procedure.** As `st-electrical`, *Turn your fix into a procedure* has a draft built from the write-up, including what didn't work. Correct it and **Send for review**; `ct-electrical` approves and `supervisor` publishes.

## More of the system

After sign-in, Operations sees **My reports** (active faults they reported), and technicians see **My jobs**. ST and PT share the same execution permissions and section pool. A Chief Technician lands on section oversight, where they see the section workload, allocate work, review escalations and approve or return technical completion. Use **Browse breakdowns** when you need the broader fault list; use **Find previous work** to search the history.

## Guided sequence

1. Sign in as `operations` and report a breakdown. If the equipment tag is uncertain, preserve the original wording and known area without confirming a suggested tag; add operating conditions and local evidence if available.
2. Sign in as `automation` to confirm the physical asset first if its identity is uncertain. Every new report, including repeat faults, starts with Systems Automation.
3. Sign in as `ct-systems-automation`. Review the new fault, choose an available ST/PT from the shared pool, and set priority, response target and instructions.
4. Sign in as `st-systems-automation` (or `pt-systems-automation`). Review the work history, acknowledge the fault and record the SCADA communication, command and feedback checks. If Electrical is needed, submit findings and a specific recommendation for review.
5. Sign in as `ct-systems-automation` and approve or return the Electrical escalation. Approval creates the linked Electrical assignment while preserving the original fault history.
6. Sign in as `ct-electrical` to allocate the work. Then sign in as `st-electrical` (or `pt-electrical`) to review inherited findings/evidence, perform tests, record unsuccessful interventions and submit any next-section recommendation for Chief review.
7. Sign in as the relevant section Chief to approve/return the escalation and allocate the next section's work. For a Mechanical assignment, use `ct-mechanical`, then `pt-mechanical` (or `st-mechanical`) to document the repair and successful restoration test.
8. The Mechanical technician requests technical completion. Sign in as `ct-mechanical` to approve it or return the work with instructions. Only after approval can `operations` confirm service restoration or return the fault to the responsible section with comments.
9. Use **Report a breakdown** for a quick report or **Find previous work** to search the section history. Open an unconfirmed-asset breakdown and use Systems Automation asset confirmation before any section handoff.
10. Review same-equipment history, possible causes, failed/successful interventions and approved procedures before repeating work.
11. Submit a reusable work-procedure update. Sign in as `ct-electrical` or `chief-engineer-electrical` to approve the technical review or request clarification. As the contributing account, revise after a clarification request.
12. Sign in as `supervisor` to inspect the technically approved queue and publish an update. It then appears in the approved library.
13. Reopen another repeat fault as a section technician, record procedure reuse, and confirm whether it helped after restoration. Repeat history is visible, but Systems Automation still receives the initial assignment.
14. Sign in as `hr` to filter contribution evidence by date and review approved procedures, colleague-confirmed reuse, intervention outcomes and response/restoration durations. Fault narratives remain restricted; the prototype weighting is illustrative only.
15. Sign in as `gm-om` to review Operations → Systems Automation → maintenance-section handoffs, section ownership, delays and timing baselines. These synthetic baselines do not claim downtime savings.
16. Sign in as `ceo` to review summary-only KPIs; individual fault records are restricted.
17. Disconnect the network and submit another fault; it is queued locally. Restore connectivity and press **Sync now**.
18. Record ranked troubleshooting causes with a quick check, fix summary, workaround flag and risk level.
19. Open GM O&M to see report-to-triage, triage-to-acknowledge, acknowledge-to-diagnose, diagnose-to-restoration and restoration-to-close median minutes.
20. Open the recognition leaderboard. It is an illustrative SOCA-compatible model, not an external SOCA or SAP integration.
