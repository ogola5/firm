/**
 * What a technician needs to know before going out, asked as a few taps.
 * Each problem has its own short follow-up questions; the answers are turned
 * into a clear written report (composeReport), so nobody has to write it.
 */

export type FollowUp = {
  key: string;
  label: string;
  kind: "choice" | "multi" | "text";
  options?: string[];
  placeholder?: string;
  required?: boolean;
  /** Only ask when another answer has this value (e.g. "how far open" only when stuck part-way). */
  when?: { key: string; value: string };
};

export type Problem = { value: string; label: string; followUps: FollowUp[] };

export const PROBLEMS: Problem[] = [
  {
    value: "Won't open / close", label: "Won't open / close",
    followUps: [
      { key: "from", label: "Fails from where?", kind: "choice", options: ["From SCADA", "At the local panel", "Both"] },
      { key: "position", label: "Position now", kind: "choice", options: ["Fully open", "Fully closed", "Stuck part-way", "Not known"] },
      { key: "percent", label: "About how far open (%)", kind: "text", placeholder: "e.g. 40", when: { key: "position", value: "Stuck part-way" } },
    ],
  },
  {
    value: "Stopped / tripped", label: "Stopped / tripped",
    followUps: [
      { key: "alarm", label: "Alarm or trip shown", kind: "text", placeholder: "e.g. P-601 motor overload trip" },
      { key: "reset", label: "Reset", kind: "choice", options: ["Not tried", "Tried, didn't work", "Worked, then tripped again"] },
    ],
  },
  {
    value: "Won't start", label: "Won't start",
    followUps: [
      { key: "from", label: "Start tried from", kind: "choice", options: ["SCADA", "Local panel", "Both"] },
      { key: "alarm", label: "Any alarm shown?", kind: "text", placeholder: "Alarm text, or leave blank" },
    ],
  },
  {
    value: "Leaking", label: "Leaking",
    followUps: [
      { key: "what", label: "What is leaking?", kind: "choice", options: ["Product", "Water", "Oil / lubricant", "Air / gas", "Not sure"] },
      { key: "amount", label: "How much?", kind: "choice", options: ["Drips", "Steady flow", "Spraying or pooling"] },
      { key: "contained", label: "Contained?", kind: "choice", options: ["Contained (bund / tray)", "Not contained"] },
    ],
  },
  {
    value: "Wrong or no reading", label: "Wrong or no reading",
    followUps: [
      { key: "which", label: "Which reading?", kind: "text", placeholder: "e.g. Tank 601 level" },
      { key: "shows", label: "It shows", kind: "text", placeholder: "e.g. 12.4 m" },
      { key: "expected", label: "Expected about", kind: "text", placeholder: "e.g. 9 m (from the dip)" },
      { key: "behaviour", label: "The reading is", kind: "choice", options: ["Frozen", "Jumping about", "Zero or blank", "Far off"] },
    ],
  },
  {
    value: "Communication lost", label: "Communication lost",
    followUps: [
      { key: "missing", label: "What is missing on SCADA?", kind: "choice", options: ["The whole station", "One device", "Some values"] },
    ],
  },
  {
    value: "Noise, vibration or heat", label: "Noise, vibration or heat",
    followUps: [
      { key: "signs", label: "What do you notice? (tick all)", kind: "multi", options: ["Noise", "Vibration", "Hot to touch", "Smell or smoke"] },
    ],
  },
  {
    value: "Alarm only", label: "Alarm only",
    followUps: [{ key: "alarm", label: "Alarm text", kind: "text", placeholder: "As shown on SCADA", required: true }],
  },
  {
    value: "Other", label: "Other",
    followUps: [{ key: "describe", label: "Describe the problem", kind: "text", placeholder: "What you saw, in your own words", required: true }],
  },
];

export const STATES = ["Running", "Stopped", "Changed over to standby", "Isolated / locked out"];
export const ACTIONS = ["Nothing yet", "Reset from SCADA", "Changed over to standby", "Isolated it", "Told the shift supervisor", "Called Systems Automation"];

export type Answers = Record<string, string | string[]>;

export function visibleFollowUps(problem: string, answers: Answers): FollowUp[] {
  const found = PROBLEMS.find((item) => item.value === problem);
  return (found?.followUps ?? []).filter((item) => !item.when || answers[item.when.key] === item.when.value);
}

export function missingFollowUps(problem: string, answers: Answers): string[] {
  return visibleFollowUps(problem, answers)
    .filter((item) => item.required && !String(answers[item.key] ?? "").trim())
    .map((item) => item.label.toLowerCase());
}

/** Answers that suggest a hazard (product spraying or not contained, smoke). The reporter still decides. */
export function looksHazardous(problem: string, answers: Answers): boolean {
  if (problem === "Leaking") {
    return answers.what === "Product" && (answers.amount === "Spraying or pooling" || answers.contained === "Not contained");
  }
  if (problem === "Noise, vibration or heat") return (answers.signs as string[] | undefined)?.includes("Smell or smoke") ?? false;
  return false;
}

const lower = (value: unknown) => String(value ?? "").trim().replace(/^./, (first) => first.toLowerCase());
const filled = (value: unknown) => (Array.isArray(value) ? value.length > 0 : String(value ?? "").trim().length > 0);

/** The problem-specific sentence, or "" if nothing was answered. */
export function problemSentence(problem: string, answers: Answers): string {
  const a = answers;
  const parts: string[] = [];
  switch (problem) {
    case "Won't open / close":
      if (filled(a.from)) parts.push(`Fails to operate ${a.from === "Both" ? "from SCADA and at the local panel" : lower(a.from)}`);
      if (filled(a.position)) parts.push(`position now ${lower(a.position)}${filled(a.percent) ? `, about ${String(a.percent).replace(/%$/, "")}% open` : ""}`);
      break;
    case "Stopped / tripped":
      if (filled(a.alarm)) parts.push(`Alarm/trip shown: ${String(a.alarm).trim()}`);
      if (filled(a.reset)) parts.push(`reset ${a.reset === "Not tried" ? "not tried" : lower(a.reset)}`);
      break;
    case "Won't start":
      if (filled(a.from)) parts.push(`Start tried from ${a.from === "Both" ? "SCADA and the local panel" : lower(a.from)}`);
      if (filled(a.alarm)) parts.push(`alarm: ${String(a.alarm).trim()}`);
      break;
    case "Leaking":
      if (filled(a.what)) parts.push(`Leaking ${lower(a.what)}`);
      if (filled(a.amount)) parts.push(lower(a.amount));
      if (filled(a.contained)) parts.push(lower(a.contained));
      break;
    case "Wrong or no reading":
      if (filled(a.which) || filled(a.shows)) {
        parts.push(`${filled(a.which) ? String(a.which).trim() : "The reading"}${filled(a.shows) ? ` shows ${String(a.shows).trim()}` : ""}`);
      }
      if (filled(a.expected)) parts.push(`expected about ${String(a.expected).trim()}`);
      if (filled(a.behaviour)) parts.push(`reading is ${lower(a.behaviour)}`);
      break;
    case "Communication lost":
      if (filled(a.missing)) parts.push(`SCADA has lost ${lower(a.missing)}`);
      break;
    case "Noise, vibration or heat":
      if (filled(a.signs)) parts.push(`Noticed: ${(a.signs as string[]).map(lower).join(", ")}`);
      break;
    case "Alarm only":
      if (filled(a.alarm)) parts.push(`Alarm: ${String(a.alarm).trim()}`);
      break;
    case "Other":
      if (filled(a.describe)) parts.push(String(a.describe).trim());
      break;
  }
  if (!parts.length) return "";
  const sentence = parts.join("; ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + (/[.!?]$/.test(sentence) ? "" : ".");
}

export type ReportDraft = {
  equipment: string;
  problem: string;
  answers: Answers;
  seen: string;
  effect: string;
  state: string;
  hazard: "yes" | "no" | "";
  actions: string[];
  notes: string;
  callback: string;
};

/** The report as the technician will read it: one line per point, no free writing needed. */
export function composeReport(draft: ReportDraft): string[] {
  const lines: string[] = [];
  if (draft.hazard === "yes") lines.push("⚠ SAFETY OR ENVIRONMENT HAZARD reported.");
  lines.push(`${draft.equipment || "Equipment not given"}${draft.problem ? `: ${lower(draft.problem)}` : ""}.`);
  const detail = problemSentence(draft.problem, draft.answers);
  if (detail) lines.push(detail);
  if (draft.seen) lines.push(draft.seen);
  const effect = [draft.effect && `Effect: ${draft.effect}`, draft.state && `equipment now ${lower(draft.state)}`].filter(Boolean).join("; ");
  if (effect) lines.push(`${effect}.`);
  if (draft.actions.length) lines.push(`Already done: ${draft.actions.map(lower).join(", ")}.`);
  if (draft.notes.trim()) lines.push(`Notes: ${draft.notes.trim()}`);
  if (draft.callback.trim()) lines.push(`Reach the reporter on ${draft.callback.trim()}.`);
  return lines;
}
