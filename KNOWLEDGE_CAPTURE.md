# Knowledge capture, recognition and the "likely to fail" list

Four parts that turn what experienced staff know, and what each breakdown teaches, into something the next person can use. People are credited by name and rewarded for it.

## 1. Recognition points and awards

**Principle:** points are earned only for *verified contributions that help colleagues*. Response times, the number of reports and other speed or volume measures never earn points, so nobody is pushed to rush or to game the figures, and nobody feels timed.

| Contribution | Starting points | Verified by |
| --- | --- | --- |
| Procedure approved | 10 | Chief, then Supervisor |
| Procedure improvement approved | 2 | Chief, then Supervisor |
| A colleague fixed it with your procedure | 5 per fix | The colleague, at write-up (using your own procedure earns nothing) |
| Expert session approved | 15 (the expert) + 3 (the person who wrote it up) | Section chief, who is not in the session |
| Drawing difference verified | 5 | Section chief (someone other than the reporter) |
| Answer accepted | 3 | The person who asked, or the section chief |
| Shadowing job completed | 3 each (adviser and the person doing the job) | Job back in service |
| Complete write-up (cause category, kind of action, back-in-service time) | 1 | Automatic |

**Rules:**
- Points are worked out from the records themselves, so they cannot be claimed by hand.
- Each piece of work is credited once.
- The value is fixed when earned: HR can change values later without rewriting history.
- There is a monthly cap per person (default 150, set by HR).

**HR (Recognition page):**
- sets the point values, the monthly cap and what a point is worth
- records redemptions (cash, voucher, day off or other; the person is emailed)
- sees points by person for the month, quarter or financial year

**Awards:**
- Employee of the Month, Quarter (financial-year quarters: Q1 is July to September) and Year, per section or overall.
- The system proposes a shortlist of five, with the evidence. The panel decides and writes the citation and prize. The winner is emailed.
- Awards are visible to everyone.

**Everyone (My points & awards):** their balance, every point with its reason and a link to the work, redemptions, how points are earned, and the awards wall.

Finance should confirm the tax treatment of cash awards. The point value shown is illustrative until HR sets it.

## 2. Pick-lists in the write-up

- **What kind of cause:** one required choice. The list is a simplified version of ISO 14224 (the oil and gas failure-coding standard), for example loose connection, wear, wrong setting, contamination, power supply, communication lost, or *unrecorded change (differs from drawing)*.
- **What kind of action:** an optional choice per step, for example replaced, tightened, adjusted, reset, cleaned, temporary fix, checked only.
- The free text stays alongside both.
- The lists are built into the app as well, so write-ups work offline.
- With these lists the library can be analysed: causes per equipment type, temporary fixes still in place, and which actions work.

## 3. Retiring expertise, and drawings that no longer match

**Knowledge at risk:**
- HR records retirement dates.
- For each equipment type in each section, the system shows who actually fixes it (successful interventions), whether a procedure or expert session exists, and how much depends on people retiring within three years.
- Each type is rated **High**, **Some risk** or **Covered**, with the reasons in words and a suggestion, for example "book an expert session and pair them on the next jobs".

**Capturing what they know:**
- **Expert sessions:** a junior writes while the expert talks, about 30 minutes per equipment type, covering how it fails, first checks, what fools people, tricks, parts and safety. The section chief approves it. It then appears in the library for every section, on the fault page and on the printed job card for that type, credited *"Expert knowledge: name, year"*.
- **Ask the expert:** questions per equipment type. The answer that solved it is marked and kept.
- **Shadowing:** the Chief Technician pairs an experienced adviser with the person doing a job. Both are credited when the equipment is back in service.

**Drawing differences:**
- The write-up asks one question: *"Did you find or change anything that differs from the drawing?"* If yes, it records what differs, the drawing number if known, and whether it is permanent or temporary.
- The section chief verifies it. From then on it is printed in a bold box on every job card for that equipment ("check before you work") and shown on the fault page.
- Verified differences are **red-lines** waiting for the drawing office. When a new revision is issued, it is marked as drawn with the revision number. Until the drawing office has accounts, the System Administrator or Maintenance Manager stands in.

**Room for KPC's digitised drawings:**
- The **drawing register** holds number, title, revision, discipline and linked equipment.
- Every drawing is *paper only* until a link to the digitised file is added. The administrator can do this now; a connector to KPC's document system can fill the links when digitisation finishes.
- Job cards and fault pages already list the drawings for the equipment, and link them once digitised.
- The open red-lines become the drawing office's to-do list for the next revisions.
- The seeded register uses made-up numbers (`ILL-…`) and is illustrative only.

## 4. Likely to fail (watch list)

Shown on the **Likely to fail** page and at the top of each technician's **My jobs**, for their own section. Every item is listed for reasons a technician can check:

- how often it fails, and how long since the last failure (for example, "fails about every 45 days; last failure 41 days ago")
- several faults in the last 90 days
- it came back within 30 days of a fix
- a temporary fix is still in place
- the same type of equipment failed several times elsewhere in the last 30 days
- a difference from its drawing has been reported but not verified

Each item also shows the usual cause and the approved procedure, if there is one. Equipment that is already broken and being worked on is not listed.

**How accurate it is, honestly:** the page rebuilds the list as it would have looked on past dates, using only what was known then, and compares it with what actually failed in the next 30 days, against the rate for all equipment. On the demonstration data, listed equipment failed within 30 days about 52% of the time, against 36% for all equipment. That is useful, and it is a guide, not a certainty.

**Later:**
- after one to two years of clean records: reliability models per equipment type, and seasonal patterns
- with condition data from SCADA (alarm counts, run hours), if approved as a separate decision: real early warning

The prototype does not connect to control systems.
