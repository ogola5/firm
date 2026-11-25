# Periodic reports

Weekly, monthly and financial-year maintenance reports. Each one can be read on screen, printed (A4), or emailed. Every figure comes from the analytics layer, so a report always agrees with the Analytics page ([METRICS.md](METRICS.md)).

## Periods

| Report | Covers | Compared with | Emailed |
| --- | --- | --- | --- |
| Weekly | Monday to Sunday | The week before | Monday 07:00, for the week just ended |
| Monthly | Calendar month | The month before (to date: the same days of the month before) | 1st of the month 07:00, for the month just ended |
| Financial year | **1 July to 30 June** (FY 2025/26 = 1 Jul 2025 – 30 Jun 2026) | The whole previous financial year; to date: the same dates a year earlier | 1 July 07:00, for the year just ended |

All times are Kenya time. A period that has not ended yet can be opened as "so far" or "to date", and the report says its figures will change. The financial-year start month is a setting (`FINANCIAL_YEAR_START_MONTH=7`).

## What is in a report

- **Headline:** faults reported, time to first response, time to restore, first-time fix, repeat faults, came back after fix, and open at the end. Each shows how many faults it comes from and the comparison in words. With fewer than 5 faults the report says "too few to compare".
- **Trend:** the 8 weeks up to the week (weekly), the 12 months up to the month (monthly), or each month of the financial year.
- **Sections:** a side-by-side comparison, in the all-sections version only.
- **Equipment needing attention:** with the reasons each item is listed.
- **Still open at the end:** with the longest-open faults.
- **Procedures published** in the period.
- **How complete are the records:** the gaps that make the figures less reliable.

## Who gets which version

| Level | Version | Scope | Emailed by default |
| --- | --- | --- | --- |
| CT, CE | Full | Own section only | Weekly, monthly, financial year |
| MM, Supervisor, System Administrator | Full | All sections, or one chosen section | MM and Supervisor: weekly, monthly, financial year |
| GM | Full | All sections, or one chosen section | Monthly, financial year |
| MD (CEO) | Headline and trends only | Company | Financial year |

Other levels (OPS, SA, ST, PT, AE, E, SE, HR) do not receive these reports. Each person can switch any of their reports on or off under **My account → Reports by email**.

## Printing and email

- **Print** on the Reports page prints only the report (A4, with the menu and controls hidden), with the online link in the footer. "Save as PDF" in the print dialog produces a file.
- **Email it to me** sends the report to the person's own KPC email at once.
- **Scheduled sending:** the server checks every 10 minutes and emails each due report once to each person who receives it. A delivery log prevents duplicates, so restarts and repeated runs are safe. `python -m app.cli send-reports` does the same from a scheduled task. The System Administrator can trigger it with `POST /api/v1/reports/send-due`.
- **What the email contains:** the headline figures in words, the top items needing attention, and a link to open and print the full report.
- **No real email in the prototype:** messages appear in the demo mailbox. With KPC's mail relay connected, a PDF attachment can be added.
