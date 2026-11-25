# The knowledge library

Illustrative prototype. All cases, people and procedures are synthetic demonstration data.

## Philosophy

- **A memory of what happened on our equipment, not a manual.** KPC already has manuals. What gets lost is what happened here: what it looked like, what we tried, what fooled us, what finally worked, and who knew.
- **Cases first, procedures distilled from them.** Experienced people recognise situations ("this is like the time the vibration monitor latched") rather than running checklists. The library leads with the problem and real cases. Procedures come out of fixes that worked.
- **Honest about failures.** "Reset from SCADA did not clear it" saves the next person 40 minutes. A failed attempt is recorded as a contribution, never as a mistake, and nobody is ranked by failures.
- **Proof and freshness on everything.** Each procedure shows who wrote it, who approved it, how often it worked or didn't, and when it was last confirmed working. A procedure not confirmed for a year is marked "check before relying on it", so trust isn't lost quietly.
- **It comes to people.** The right knowledge appears on the job card, the fault page and the write-up. Search is the fallback, not the front door.
- **Contributing raises standing.** Names go on procedures, colleagues' successes are reported back to the author, points are earned, and (if management approves) it counts in appraisal. This answers the fear that sharing knowledge reduces job security.
- **Never used to blame.** The first time a write-up is used against someone, honest recording stops.

## How it is organised

The library follows the way a problem arrives:

```
Equipment type (Pumps, Motor-operated valves, Level transmitters, ...)
 └─ Problem, in the words Operations use when reporting ("Won't start", "Won't open / close", ...)
     ├─ Likely causes: how often each was confirmed, and what to check first
     ├─ What worked, and what didn't work (with why)
     ├─ Approved procedures: evidence (worked / didn't), last confirmed working, versions and contributors
     └─ The cases themselves, newest first
 Side panel: knowledge owner, watch-outs (expert notes, drawing differences, safety),
             older paper work instructions, the equipment of this type with station and region
```

Knowledge is shared across all sections and regions: a fix learnt at the Coast helps Nairobi.

## Decisions taken

1. **A knowledge owner per equipment type**, a named Chief Technician or Senior Engineer.
   - Named by the section's Chief Engineer, the Maintenance Manager or the System Administrator.
   - The owner is emailed when a procedure for their type is written, improved or published.
   - Their home page shows procedures that need checking.
   - They can withdraw a procedure that no longer applies, with a reason.
2. **Knowledge contribution in HR appraisal: yes, subject to management approval.**
   - Until then the appraisal evidence shows it marked "Proposed" (setting `APPRAISAL_KNOWLEDGE_STATUS`; set it to `APPROVED` once management approves).
   - Measures: procedures approved, improvements to colleagues' procedures, colleagues helped (confirmed reuse), expert sessions given, equipment types owned.
3. **Worked cases filled in first for the types that fail most** (illustrative):
   - pumps, motor-operated valves, level transmitters, strainers, RTUs and variable speed drives
   - each case has the failed attempts, the fix and a procedure, plus the colleague reuses, one improvement by a colleague and one fading procedure

## What happens

- **One clear answer:**
  - When someone writes up a procedure, the app shows similar approved procedures (same equipment, same problem, similar cause) and asks: "Does this add to a procedure we already have?"
  - If yes, the write-up becomes the next version, credited to the new contributor.
  - When it is published, the earlier version is marked **Superseded** and stays in the history.
  - Only the newest version is current guidance.
- **Withdrawn:**
  - The owner, the Chief Engineer or a supervisor can withdraw a procedure that no longer applies, for example after the equipment is modified.
  - It leaves current guidance and stays in the history.
  - The credit stays with its author.
- **The thank-you loop:** when a colleague confirms that someone's procedure fixed their fault:
  - the author is emailed
  - their home page shows "Your knowledge at work"
  - points are earned
- **Fading:** after `KNOWLEDGE_FADE_DAYS` (default 365) without a confirmed success, a procedure is shown as needing checking.

## What software cannot do alone

- **Leaders quote it.** Senior and Chief Engineers referring to library entries in meetings is what makes technicians use it.
- **Champions:** one respected champion per region (Western, Nairobi, Coast).
- **Retiring staff:** a dignified handover, framed as their legacy and credited by name.
- **Good first entries:** the first entries must be genuinely useful. The first few looks decide whether people come back.

## API

| Endpoint | Who | What |
|---|---|---|
| `GET /api/v1/library/types` | technical roles, managers, supervisor, admin | Equipment types, most faults in the last year first, with procedures, fading, expert notes, drawing differences and owner. |
| `GET /api/v1/library/types/{code}` | same | The type page described above. |
| `GET /api/v1/library/owner-candidates` | CE (own section), MM, admin | Active CTs and SEs. |
| `PUT /api/v1/library/types/{code}/owner` `{"user_id"}` | CE (own section), MM, admin | Names the knowledge owner and emails them. |
| `POST /api/v1/procedure-updates/{id}/withdraw` `{"reason"}` | Owner, CE (own section), supervisor, MM | Marks it Withdrawn and kept in history. |
| `GET /api/v1/faults/{id}/procedure-matches` | anyone who can see the fault | Up to 3 approved procedures this write-up might add to, with reasons. |
| `POST /api/v1/faults/{id}/procedure-updates` with `builds_on_id` | procedure authors | Submits as the next version of that procedure. |
| `GET /api/v1/me/knowledge-impact` | signed-in | Colleagues helped, types owned, procedures needing checking. |
