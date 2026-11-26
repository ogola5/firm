/**
 * Short confirmations shown near the thumb ("Recorded: you are on site."), instead of a box at the top of a
 * long page that the person never sees. Tiny store: no library, works offline.
 */
export type Toast = { id: number; tone: "success" | "error" | "info"; text: string; action?: { label: string; run: () => void } };

type Listener = (toasts: Toast[]) => void;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener(toasts));

export function dismiss(id: number) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

function show(tone: Toast["tone"], text: string, action?: Toast["action"], ms?: number) {
  const item: Toast = { id: nextId++, tone, text, action };
  toasts = [...toasts.slice(-2), item]; // at most three on screen
  emit();
  setTimeout(() => dismiss(item.id), ms ?? (tone === "error" ? 9000 : 6000));
  return item.id;
}

export const toast = {
  success: (text: string, action?: Toast["action"]) => show("success", text, action),
  error: (text: string) => show("error", text),
  info: (text: string, action?: Toast["action"]) => show("info", text, action),
};

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}
