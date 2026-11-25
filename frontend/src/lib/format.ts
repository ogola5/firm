export function dateTimeLocal(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "14:05" */
export function clockTime(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "today 14:05", "yesterday 09:10" or "12 Nov 14:05" — how people say it. */
export function spokenTime(value: unknown, now = new Date()): string {
  if (!value) return "";
  const date = new Date(String(value));
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(date)) / 86_400_000);
  if (diffDays === 0) return `today ${clockTime(date)}`;
  if (diffDays === 1) return `yesterday ${clockTime(date)}`;
  return `${date.getDate()} ${date.toLocaleString("en-GB", { month: "short" })} ${clockTime(date)}`;
}

/** Combines "today"/"yesterday" and "HH:MM" (local) into an ISO timestamp. */
export function isoFromDayAndTime(day: "today" | "yesterday", time: string, now = new Date()): string | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  const moment = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  if (day === "yesterday") moment.setDate(moment.getDate() - 1);
  return moment.toISOString();
}

/** "Stopped: Operation stopped or at risk" -> "Stopped" */
export function shortEffect(value: unknown): string {
  return String(value ?? "").split(":")[0].trim();
}
