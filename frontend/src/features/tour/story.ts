/**
 * Guided demo for presentations: the Line 4 pump story, one chapter per person.
 * Each chapter switches to that person's demonstration account and opens the right screen.
 * Demonstration accounts only (demo.<name>@kpc.co.ke, password demo123).
 */
export type Chapter = { title: string; who: string; username: string; path: string; notice: string[] };

export const STORY: Chapter[] = [
  {
    title: "Operations reports the fault", who: "Control room operator", username: "operations", path: "/report?equipment=11-P-401",
    notice: ["Mostly taps: the report writes itself from the answers.", "It says if this equipment failed before.",
      "Safety is one tap and goes to the top of every list."],
  },
  {
    title: "Systems Automation hears about it", who: "Systems Automation", username: "automation", path: "/dashboard",
    notice: ["The bell and “Needs you now”: one list, safety first.", "Nobody has to phone around to find out it was reported."],
  },
  {
    title: "The Chief Technician gives it to a technician", who: "Chief Technician", username: "ct-systems-automation", path: "/dashboard",
    notice: ["Only technicians in the same section and region, and who are available, can be chosen.", "The technician is told at once."],
  },
  {
    title: "The technician takes it and writes up the visit", who: "Principal Technician (on a phone)", username: "pt-systems-automation", path: "/dashboard",
    notice: ["“Take this job”, print the job card, go: no phone at the equipment.", "Afterwards: what was found, each step tried, and whether it worked."],
  },
  {
    title: "Sign-off: every attempt, including what failed", who: "Chief Technician", username: "ct-systems-automation", path: "/faults?mode=history&q=11-P-401",
    notice: ["The next step says exactly what to do: “Review and sign off”.", "Failed attempts are kept: they save the next person time."],
  },
  {
    title: "Operations confirms it works", who: "Control room operator", username: "operations", path: "/dashboard",
    notice: ["The person who reported it closes it, not the technician.", "If it is not fixed, it goes straight back."],
  },
  {
    title: "The fix becomes knowledge", who: "Senior Technician", username: "st-mechanical", path: "/library/PUMP",
    notice: ["Organised by problem: likely causes, what worked, what didn't.", "Each procedure shows how often it worked and when it was last confirmed."],
  },
  {
    title: "Legacy systems: what is not on the drawings", who: "Systems Automation", username: "automation", path: "/library/systems/SYS-L4-PUMP-A",
    notice: ["How the parts connect, known limitations, and every change over the years.", "Knowledge from retiring staff is credited by name."],
  },
  {
    title: "Escalation only when it is needed", who: "Senior Engineer", username: "senior-engineer-mechanical", path: "/escalations",
    notice: ["Routine work stays with the Chief Technician.", "Senior Engineer by region; Chief Engineer only if it persists."],
  },
  {
    title: "Management sees the trends", who: "Maintenance Manager", username: "maintenance-manager", path: "/analytics",
    notice: ["Response and repair times, repeats, and what is likely to fail next.", "Every figure says how many faults are behind it."],
  },
  {
    title: "Recognition for knowledge that helps others", who: "HR", username: "hr", path: "/recognition",
    notice: ["Points only for verified contributions, never for report volume.", "Counting it in appraisal is proposed, for management to approve."],
  },
];

const STEP_KEY = "kpc-tour-step";

export function tourStep(): number | null {
  const value = sessionStorage.getItem(STEP_KEY);
  return value === null ? null : Math.min(Math.max(Number(value), 0), STORY.length - 1);
}

export function endTour() {
  sessionStorage.removeItem(STEP_KEY);
}

/** Switch to the chapter's demonstration account and open its screen (a full load, so nothing from the last person remains). */
export async function showChapter(index: number, api: (path: string, init: RequestInit) => Promise<{ access_token: string; user: unknown }>) {
  const chapter = STORY[index];
  const result = await api("/api/v1/auth/login", {
    method: "POST", body: JSON.stringify({ email: `demo.${chapter.username}@kpc.co.ke`, password: "demo123" }),
  });
  localStorage.setItem("kpc-token", result.access_token);
  localStorage.setItem("kpc-user", JSON.stringify(result.user));
  localStorage.removeItem("kpc-offline-session");
  sessionStorage.setItem(STEP_KEY, String(index));
  window.location.assign(chapter.path);
}
