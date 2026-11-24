import { registerSW } from "virtual:pwa-register";

/**
 * Registers the Workbox service worker (production builds only; the dev server
 * provides a no-op). New versions activate on the next load so a user is never
 * switched mid-task.
 */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  registerSW({ immediate: true });
}
