/**
 * After a new version is deployed, a page that was already open still asks for the
 * previous version's screen files, which no longer exist. Reload once to get the new
 * version. Unsent work is safe: it is kept in the device's outbox (IndexedDB).
 */
const KEY = "kpc-reloaded-for-new-version";
const STALE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Expected a JavaScript/i;

export function isStaleVersionError(reason: unknown): boolean {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? "");
  return STALE.test(text);
}

export function reloadForNewVersion(): boolean {
  // At most once a minute, so a real outage cannot cause a reload loop.
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 60_000) return false;
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
  return true;
}

export function reloadWhenVersionChanges() {
  // Vite reports a failed lazy import with this event.
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleVersionError(event.reason) && reloadForNewVersion()) event.preventDefault();
  });
}
