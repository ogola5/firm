/**
 * Display mode: day (default), night (night shifts, control rooms), sunlight (outdoors), or follow the phone.
 * Stored on this device only; applied before the first paint so there is no flash.
 */
import { useEffect, useState } from "react";

export type ThemeChoice = "auto" | "day" | "night" | "sun";
const KEY = "kpc-theme";
const COLORS: Record<string, string> = { day: "#12324a", night: "#0b1520", sun: "#ffffff" };

export function storedTheme(): ThemeChoice {
  const value = localStorage.getItem(KEY);
  return value === "day" || value === "night" || value === "sun" ? value : "auto";
}

function resolve(choice: ThemeChoice): "day" | "night" | "sun" {
  if (choice !== "auto") return choice;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

export function applyTheme(choice: ThemeChoice = storedTheme()) {
  const theme = resolve(choice);
  if (theme === "day") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORS[theme]);
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);
  useEffect(() => {
    applyTheme(choice);
    if (choice !== "auto") return;
    // Following the phone: change when the phone switches between light and dark.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => applyTheme("auto");
    media?.addEventListener("change", update);
    return () => media?.removeEventListener("change", update);
  }, [choice]);
  return [choice, (next) => {
    if (next === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    setChoice(next);
  }];
}
