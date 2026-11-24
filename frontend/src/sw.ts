/// <reference lib="webworker" />
/**
 * Service worker (Workbox, injectManifest).
 *
 * - Precaches the built app shell so the installed app opens with no network.
 * - Serves index.html for in-app navigations (single-page routes).
 * - Never caches /api: the app keeps its own offline data in IndexedDB and
 *   must see real network failures to queue work in the outbox.
 * - Background Sync (where supported) wakes the open app to flush its outbox.
 */
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

// Take control on first install so the very first session is already usable offline.
void self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("sync", (event) => {
  const syncEvent = event as Event & { tag: string; waitUntil(promise: Promise<unknown>): void };
  if (syncEvent.tag !== "kpc-outbox") return;
  syncEvent.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" })
      .then((clients) => clients.forEach((client) => client.postMessage({ type: "kpc-sync" }))),
  );
});
