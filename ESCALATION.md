# Regions and escalation

Illustrative model for the demonstration. Regions, stations and people are synthetic.

## Regions

Each maintenance section (Systems Automation, Electrical, Instrumentation, Mechanical) works in three regions: **Western, Nairobi and Coast**. Each region has its own pump stations.

| Demo station | Region |
|---|---|
| PS01 | Coast |
| PS02, PS04 (Line 4) | Nairobi |
| DEPOT01 | Western |

**Who sees what:**

- **Regional staff (ST, PT, CT, AE, E, SE)** belong to one region. They see their section's equipment and faults in that region only. Equipment that has not been identified yet has no region, so the whole section sees it until it is identified.
- **The Chief Engineer (CE)** covers the whole section, in every region.
- **Managers and Operations** see everything, as before.
- **Procedures, the knowledge library, expert knowledge and drawings** stay section-wide. A fix learnt at the Coast helps Nairobi.

The CT allocates work only to STs and PTs in their own section and region.

**Accounts:** the region is part of the account, like the section.

- People choose it when they enrol.
- The System Administrator confirms or changes it when approving, creating an account or changing access.
- Changing it signs the person out, so they come back to the right view.

## Who escalates to whom

```
ST / PT  ->  CT (signs off routine work)
             |  asks, safety report, or not back in service after 8 h
             v
         Senior Engineer of the section, in that region
             |  same equipment failed again within 30 days of a fix,
             |  or the SE says it needs something extra
             v
         Chief Engineer of the section (all regions)
```

| Level | With | How it gets there |
|---|---|---|
| 0 | Chief Technician | Every fault starts here. Routine work is signed off by the CT. |
| 1 | Regional Senior Engineer | **The CT asks**, with a reason ("Ask the Senior Engineer").<br>**Safety report:** immediately when Operations ticks the hazard.<br>**Not back in service after 8 hours:** automatic. |
| 2 | Section Chief Engineer | **Persists:** the same equipment fails again within **30 days** of being fixed (automatic, at report time or on the next check).<br>**The SE escalates it** with a reason: needs spares or a purchase, a design change, a contractor or specialist, keeps coming back after fixes, or other. |

**Rules:**

- **Levels only go up.** Once restored or closed, a fault leaves the escalation lists.
- **Notification:** each escalation is emailed (the demo mailbox) to the SEs of the section in that region, or to the section's CE. It is also recorded on the fault's timeline (`FAULT_ESCALATED`).
- **Guidance:** the SE (level 1 or 2) and the CE (level 2) can add guidance. It is emailed to the CT and the assigned technician, and shown on the fault page and on the technician's job in My jobs.
- **Which section:** the section that owns the equipment answers for it, even while Systems Automation is still sorting the fault. When the CT or SE of the section working on it escalates, it goes up their own line.
- **When the rules run:** the time-based rules run with the background check every 10 minutes (`REPORT_SCHEDULER`).
- **Settings:** the limits are `SE_AFTER_HOURS` (default 8) and `CE_REPEAT_DAYS` (default 30).

## Screens

- **SE home (My jobs):** "Escalated to you" at the top when there is anything.
- **CE home (Section engineering):** the same panel, with level 2 faults only. "Escalated" is a bottom tab on phones.
- **Escalations page** (menu): for SE, CE, MM, GM, Supervisor and System Administrator. The lists are "With the Chief Engineer" and "With the Senior Engineer".
- **Fault page:**
  - the escalation card shows the level, the time, the reason and the guidance
  - the CT sees "Ask the Senior Engineer"
  - the SE sees "Escalate to the Chief Engineer" and "Add guidance"
  - the CE sees "Add guidance"
- **My jobs:** a badge "With the Senior Engineer" or "With the Chief Engineer", with the engineer's guidance.

## Demo accounts

Password `demo123` for all of them.

- **Nairobi:** the existing teams, for example `demo.ct-electrical@kpc.co.ke` and `demo.senior-engineer-mechanical@kpc.co.ke`.
- **Coast and Western:** each section has an ST, PT, CT and SE, for example `demo.ct-mechanical-coast@kpc.co.ke` and `demo.senior-engineer-electrical-western@kpc.co.ke`.
- **Chief Engineers:** one per section, for example `demo.chief-engineer-mechanical@kpc.co.ke`.
