# Measures

One agreed definition per measure. Dashboards, trends and (later) periodic reports all compute from `backend/app/services/analytics/`, so they cannot disagree. Every figure is shown with the number of faults behind it (`n`).

All figures in this prototype come from **illustrative data**. They demonstrate the method; they are not KPC performance.

## Times used

| Moment | Source |
|---|---|
| Reported | When the report was submitted (`faults.created_at`). |
| First response | The first acknowledgement of the job, normally by Systems Automation (first `FAULT_ACKNOWLEDGE` event). |
| On site | The first `FAULT_ON_SITE` event. For written-up visits this is the arrival time the technician entered from their notes. |
| Restored | When the equipment worked again (`faults.restored_at`). For written-up visits this is the technician's back-in-service time, not the sign-off. |

Periods and weekly/monthly buckets use **Kenya time (Africa/Nairobi)**. Weeks start on Monday. A fault belongs to the period in which it was **reported**, unless stated otherwise.

Times are summarised with the **median**, not the mean: one 30-hour job should not hide twenty 1-hour jobs.

## Measures

| Measure | Definition | Better | Notes |
|---|---|---|---|
| Faults reported | Reports submitted in the period. | Neither (context) | Volume is workload, not performance. |
| Time to first response | Median minutes from reported to first response. | Lower | |
| Time to get on site | Median minutes from reported to on site. | Lower | Only faults with an on-site time. |
| Time to restore | Median hours from reported to restored. | Lower | Only restored faults. This is time to restore, not measured downtime: operation may have continued. |
| First-time fix | % of restored faults whose **first** recorded attempt worked. | Higher | Only faults with at least one recorded attempt. |
| Repeat faults | % of reports on identified equipment that had another report on the same equipment in the previous 90 days. | Lower | Unidentified equipment is excluded. |
| Came back after fix | % of restored faults with a new report on the same equipment within 30 days of restoration. | Lower | Counted by restoration date; only faults restored at least 30 days ago, so the window is complete. |
| Failed attempts per fault | Mean failed attempts among faults with recorded attempts. | Lower | A high value is also a sign of honest recording; read with first-time fix. |
| Open at period end | Faults reported before the end of the period and not restored by then. | Lower | A snapshot at the end of each bucket. |

## Comparing periods

"This period" is compared with the period of the same length immediately before it. A change is called **better** or **worse** using the direction above. When either period has fewer than **5** faults behind a figure, the comparison is shown as **too few to compare**.

## Intelligence

**Equipment needing attention.** Equipment with faults reported in the period, ranked by faults + repeats + 2 × came-back-after-fix, ties broken by total hours to restore. Each row lists the reasons in words.

**Section comparison.** Per owning section: faults, median first response and restore, first-time fix, repeat faults and open now, each with its `n`. Sections handle different equipment, so compare a section with its own trend before comparing it with others.

**Similar past faults.** For a given fault, earlier faults are scored:

`score = 0.40·E + 0.25·S + 0.20·C + 0.15·R`

- **E**, equipment: 1 for the same equipment, 0.5 for the same type of equipment (for example another MOV), otherwise 0.
- **S**, symptom: word overlap between the two problem descriptions (Jaccard, 0–1).
- **C**, category: 1 for the same fault category, otherwise 0.
- **R**, relevance: 0.6 if the earlier fault was fixed, plus 0.4 × recency (halving roughly every four months).

Weights are configurable (`SIMILARITY_WEIGHTS`). Each result says why it was ranked. **A similar fault is not proof of the same cause**: it is a lead to check.

## Data quality

Shown alongside the figures, because poor records make the figures wrong:

| Check | Why it matters |
|---|---|
| Equipment still unidentified | Excluded from repeat and equipment measures. |
| Restored without a back-in-service time | The restoration time falls back to the sign-off time, which overstates time to restore. |
| Written up more than 24 hours after the visit | Late write-ups lose detail. |
| Restored without any recorded cause | Nothing to learn from for next time. |
| Open with no activity for 7 days | Possibly forgotten. |

## Prototype limits

Figures are computed on request from the records. At production volumes these should become database aggregations or a nightly summary table; the definitions above stay the same.
