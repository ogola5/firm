# Demonstration Guide

All data and identities are illustrative.

Sign in with a KPC email address. Each seeded account below is `demo.<name>@kpc.co.ke`: for example, `operations` is `demo.operations@kpc.co.ke`. There is no role list on the sign-in page: the account itself decides the level, section and region, and the home page you land on. To try it as yourself, choose **Create an account**, pick your job and section, and have `admin` approve it. No email is ever sent to these addresses. In this guide, "sign in as `operations`" means that account.

| Role | Name (email `demo.<name>@kpc.co.ke`) | Password |
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
| System Administrator (ICT) | admin | demo123 |
| Developer / Owner (admin console with developer tools) | developer | demo123 |

Technician and engineer accounts are seeded for each section: Systems Automation (which now includes the former Instrumentation and Control section), Electrical and Mechanical. In the login selector, select the section and level. The usernames above are Electrical examples.

See [ROLE_ACCESS_MATRIX.md](ROLE_ACCESS_MATRIX.md) for role scope and visibility rules.

## Demo data: a small sample that grows with use

The live demo starts from a small sample (`SEED_PROFILE=sample`): one example on each page. That means eight faults, one at each stage, three earlier fixes on the Line 4 pump, and a few procedures. Everything else comes from using it. The local Docker stack and the automated tests load the full illustrative history (`SEED_PROFILE=full`). To start the live demo again from the sample, sign in as `developer` and use Admin console → Developer tools → Reset demo data.

Each home page shows a short welcome until you press **Got it**. **Quick guide** in the menu has one printable page for each role.

## New staff: enrol with a KPC email

1. On the sign-in page, choose **Create an account**. Enter a KPC address (for example `amina.otieno@kpc.co.ke`), your full name, staff number, the job and section you need, and a password. An address outside `@kpc.co.ke` is refused.
2. For the demonstration there is no emailed code, and a password needs only 4 or more characters with letters and numbers (for example `abc1`). Both can be changed in Admin console → Rules. Turn the emailed code on only once a mail service is connected.
3. Signing in now says the account is **waiting for approval**. To let people try the system without waiting, switch on Admin console → Rules → "New accounts work at once, without administrator approval".
4. Sign in as `admin` and open **User management → Account requests**. Check the person, confirm or correct the job and section, and **Approve**, or **Reject** with a reason they will see.
5. Sign in as the new person. They see the dashboard for the role they were given, and **My account** shows their details, what they can do, and lets them change their password.

**Forgot password?** on the sign-in page sends a code to the KPC email in the same way.

## Desk workflow (start here)

Operators report from the control-room desk after seeing a problem on SCADA or on a site walk. Technicians carry no device on site: they print a job card, take notes on it, and write the visit up at their desk afterwards.

1. **Report (control room).** Sign in as `operations`. **Report a fault** asks four things: which equipment (type a tag like `11-MOV-501` or a description like `tank 601 inlet valve`; confirm the best match with **Yes, this one**, or send your description to be identified), where and when it was seen, what is wrong and the effect. **Who should come?** is already set to the section that looks after the equipment; choose another (Mechanical, Electrical or Systems Automation) if you know better. Paste a SCADA screenshot with Ctrl+V. Priority follows from the effect.
2. **Anyone free takes it.** It goes straight to that section; there is no Systems Automation step and no waiting for the Chief Technician. As `st-electrical`, **My jobs** lists it under *New: nobody has taken it yet*. Click **Take this job**: the first to take it gets it, and the Chief Technician is told. Someone free in another section can take it too (*Other sections: not taken yet*).
3. **Print the card and go.** **Print job card**: one A4 sheet with the problem, what worked and failed last time, and note lines in the same order as the write-up screen. Need a hand? On the fault, **Call someone to help** asks a colleague from any section; they see the job and are credited with it.
4. **Write up the visit.** Under *To write up*, click **Write up visit**. Enter the arrival and back-in-service times from the notes (they are recorded as the times things happened), what you found (tap a cause found before, or type one), and each thing you did marked **Worked**, **Didn't work** or **Partly**. **Save: it's working again** puts it back in service at once.
5. **Confirmation, then the write-up check.** As `operations`, confirm it works; that closes it. As `ct-electrical`, **Check the write-up** afterwards: **Write-up is good**, or **Ask for more detail** (the technician adds to it; the fault stays closed). The restoration time is the one the technician entered.
6. **Procedure.** As `st-electrical`, *Turn your fix into a procedure* has a draft built from the write-up, including what didn't work. Correct it and **Send for review**; `ct-electrical` approves and `supervisor` publishes.

## More of the system

After sign-in, Operations sees **My reports** (active faults they reported), and technicians see **My jobs**. Anyone technical can take a job nobody has taken, from any section. A Chief Technician lands on section oversight: who took what, write-ups to check, hand-overs to approve, and anything nobody has taken for 15 minutes (they can still give a job to a particular person). Use **Browse breakdowns** when you need the broader fault list; use **Find previous work** to search the history.

## Guided sequence

1. Sign in as `operations` and report a breakdown, choosing **Who should come?** (Systems Automation here). If the equipment tag is uncertain, preserve the original wording and known area without confirming a suggested tag; add operating conditions and local evidence if available.
2. Sign in as `st-systems-automation` (or `pt-systems-automation`). If the asset is not identified, confirm it on the fault page (**Which equipment is it?**), then **Take this job**. Record the SCADA communication, command and feedback checks. If Electrical is needed, either **Call someone to help** from Electrical, or hand the job over with findings and a specific recommendation.
3. A hand-over still goes to the Chief Technician: sign in as `ct-systems-automation` and approve or return it. Approval creates the linked Electrical assignment while preserving the original fault history; anyone free in Electrical can then take it.
4. Sign in as `st-electrical` (or `pt-electrical`) to take it, review inherited findings/evidence, perform tests and record unsuccessful interventions. For a Mechanical part of the job, call `pt-mechanical` in to help, or hand it over to Mechanical.
5. When it works, **It's working again**: it is back in service at once. `operations` confirms service restoration (or returns the fault with comments). The section's Chief Technician checks the write-up afterwards and can ask for more detail.
6. Use **Report a breakdown** for a quick report or **Find previous work** to search the section history.
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
