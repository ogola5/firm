/**
 * In-app help: the three-line welcome on each home, a one-page quick guide per role, and the words
 * behind the "?" hints. Plain language; one idea per line.
 */
export type Guide = {
  /** Shown once on the home page until dismissed. */
  welcome: string[];
  /** The quick guide: the daily tasks, step by step. */
  tasks: Array<{ title: string; steps: string[] }>;
  tips: string[];
};

const FIELD: Guide = {
  welcome: [
    "\"Needs you now\" at the top lists what is waiting for you, most urgent first.",
    "Anyone free can take a new job: \"Take this job\", print the job card, go.",
    "Back at your desk, write up the visit; \"It's working again\" puts it back in service at once.",
  ],
  tasks: [
    { title: "Take a new job", steps: ["Open My jobs: new faults are under \"New: nobody has taken it yet\".", "Press Take this job. The first to take it gets it.", "Print job card and take it with you (no phone at the equipment)."] },
    { title: "Need a hand?", steps: ["Open the fault and press Call someone to help.", "Choose anyone, from any section. They are told and credited."] },
    { title: "Write up the visit", steps: ["My jobs → To write up → Write up visit.", "Enter the times from your notes, what you found, and each thing you tried: Worked / Didn't work / Partly.", "Save: it's working again. Operations confirm; your Chief Technician checks the write-up later."] },
    { title: "Share what you learnt", steps: ["After a fix, My jobs offers \"Turn your fix into a procedure\": a draft is ready.", "Check it and send it for review. Your name goes on it."] },
  ],
  tips: ["Before you go, open \"What we know\" on the fault: what worked and what didn't last time.", "Sent to another section but you are free? You can take it too."],
};

export const GUIDES: Record<string, Guide> = {
  my_reports: {
    welcome: [
      "Report a fault in a few taps: which equipment, what is wrong, the effect.",
      "\"Who should come?\" is already set to the section that looks after it; change it if you know better.",
      "When it is fixed, you confirm it works. That closes it.",
    ],
    tasks: [
      { title: "Report a fault", steps: ["Press Report a fault.", "Type the tag or describe it (\"tank 601 inlet valve\"); press Yes, this one.", "Tap what is wrong and the effect. If anyone or anything is at risk, choose Yes.", "Check who should come, then Submit report."] },
      { title: "Confirm a repair", steps: ["When maintenance says it is working again, it appears in \"Needs you now\".", "Check on site or on SCADA, then Yes, it works: close it, or say what is still wrong."] },
    ],
    tips: ["Not sure which equipment? Describe it and send it to be identified.", "Safety first: a hazard goes to the top of every list."],
  },
  my_jobs: FIELD,
  section_oversight: {
    welcome: [
      "Your people take new work themselves; you no longer have to allocate every job.",
      "\"Needs you now\" shows write-ups to check, hand-overs to approve, and anything nobody has taken for a while.",
      "Checking a write-up never holds up the repair: it is already working again.",
    ],
    tasks: [
      { title: "Check a write-up", steps: ["Open it from \"Needs you now\" or \"To check\".", "Read what was found and tried (failed attempts too).", "Write-up is good, or Ask for more detail with what is missing."] },
      { title: "Nobody has taken a job", steps: ["After the set time it appears in \"Needs you now\".", "Open it and use Give it to someone."] },
      { title: "Approve a hand-over", steps: ["When a job is handed to another section, check the findings, then approve or send it back."] },
      { title: "Review a procedure", steps: ["Procedure review in the menu: check it is right, then send it for publishing or ask a question."] },
    ],
    tips: ["You are told when someone takes a job, so you always know who is on what."],
  },
  section_engineering: {
    welcome: [
      "You see faults escalated to you first: the ones that persist or need a decision.",
      "Add your guidance on the fault; the person on the job is told.",
      "Below that, how your section is doing across the regions.",
    ],
    tasks: [
      { title: "Guide an escalated fault", steps: ["Open it from \"Needs you now\" or Escalations.", "Read what has been tried, then Add guidance."] },
      { title: "Read your section's trends", steps: ["Analytics: response and repair times, repeats, what is likely to fail."] },
    ],
    tips: ["Escalation reaches you only when it is needed: not working after the set hours, a safety report, or a repeat soon after a fix."],
  },
  maintenance_overview: {
    welcome: [
      "All sections at a glance: open faults, response and repair times, repeats.",
      "Every figure says how many faults it is based on.",
      "Reports in the menu give the weekly, monthly and yearly summary to print or email.",
    ],
    tasks: [
      { title: "See how maintenance is doing", steps: ["Analytics: pick the period and section.", "Likely to fail (under More): equipment that may fail soon, with the reasons."] },
      { title: "Name a knowledge owner", steps: ["Library → an equipment type → Owner: the person who keeps its knowledge current."] },
    ],
    tips: ["With fewer than five faults a figure says \"too few to compare\" instead of a misleading trend."],
  },
  om_overview: {
    welcome: ["How faults move from Operations through each section, and where they wait.", "Analytics and Reports hold the detail.", "Every figure says how many faults it is based on."],
    tasks: [{ title: "Find where work waits", steps: ["Home: the flow from report to confirmation.", "Analytics: response and repair times by section."] }],
    tips: [],
  },
  supervision: {
    welcome: ["Procedures checked by a Chief Technician wait for you to publish them.", "Once published, everyone finds them in the library.", "\"Needs you now\" shows how many are waiting."],
    tasks: [{ title: "Publish a procedure", steps: ["Procedure review: read it, including the failed attempts behind it.", "Publish, or send a question back."] }],
    tips: [],
  },
  executive: {
    welcome: ["Headline figures and trends only.", "Reports gives a printable summary for any period.", "No individual fault or person is shown here."],
    tasks: [{ title: "Read the headline", steps: ["Home and Analytics: faults, time to restore, repeats, compared with the previous period."] }],
    tips: [],
  },
  workforce: {
    welcome: ["Staff, roles and contribution evidence; no fault details.", "Recognition: points for verified knowledge contributions, and awards.", "Counting knowledge in appraisal is proposed, for management to approve."],
    tasks: [
      { title: "Record a retirement date", steps: ["People → the person → Retirement date: their knowledge is flagged for capture."] },
      { title: "Award or redeem points", steps: ["Recognition: record an award, or redeem points for someone."] },
    ],
    tips: [],
  },
  administration: {
    welcome: [
      "Account requests come first: approve, correct or reject them.",
      "The Admin console has Health, Rules, the Equipment register and the Audit trail.",
      "You run the system; maintenance decisions stay with maintenance.",
    ],
    tasks: [
      { title: "Approve an account", steps: ["User management → Account requests: check the person, confirm their job, section and region, Approve."] },
      { title: "Check the system", steps: ["Admin console → Health: everything should say OK. Anything else is explained there."] },
      { title: "Change a rule", steps: ["Admin console → Rules: change the number, Save. It applies at once and is recorded in the Audit trail."] },
      { title: "Add demo equipment", steps: ["Admin console → Equipment register → Add equipment, or Import from a spreadsheet (Check first, then Import)."] },
    ],
    tips: ["The developer account also has View as (read-only), the banner, feature switches and Reset demo data."],
  },
};

export function guideFor(home: string): Guide {
  return GUIDES[home] ?? FIELD;
}

/** The words behind the "?" hints. */
export const TERMS: Record<string, string> = {
  "needs-you": "One list of what is waiting for you, most urgent first: safety, then what is holding someone else up, then your own work. Each line has one button.",
  "likely-to-fail": "Equipment that may fail soon, worked out from its own history: repeats, temporary fixes still in place, and how long since the last failure. Each one says why it is listed.",
  escalation: "When a fault is brought to an engineer: to the regional Senior Engineer if it is not working again after the set hours, is a safety report, or the Chief Technician asks; to the section Chief Engineer if it keeps coming back or needs spares, a design change or a contractor.",
  "write-up-check": "After a fix, the Chief Technician reads the write-up: is what was found and tried clear enough for the next person? It never holds up the repair; the equipment is already working again.",
  sync: "Work saved on this device while there was no connection. It is sent by itself when the connection is back. \"Conflicts\" are changes someone else made meanwhile: you choose which to keep.",
  "open-pickup": "Anyone free can take a new job, from any section. The first to take it gets it, and their Chief Technician is told.",
  library: "What worked and what didn't, organised by type of equipment and by problem, with the procedures that came out of real fixes.",
};
