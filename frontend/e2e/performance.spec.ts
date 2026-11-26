/**
 * Frontend performance measurements for PERFORMANCE_REPORT.md.
 * Run against the production build:  PERF=1 scripts/e2e.sh performance
 * Writes frontend/perf-results/frontend.json. Measures; asserts nothing.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { signIn } from "./helpers";

test.skip(!process.env.PERF, "Set PERF=1 to run the performance measurements");

type Probe = {
  seedEquipment(count: number): Promise<number>;
  clearSeed(): Promise<void>;
  searchEquipment(query: string): Promise<{ ms: number; count: number }>;
  faultHistory(id: string): Promise<{ ms: number; found: boolean }>;
  persistEvent(): Promise<{ ms: number }>;
  cachedFaultIds(): Promise<string[]>;
};

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, p50: +pick(0.5).toFixed(2), p95: +pick(0.95).toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) };
}

async function probe<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([name, params]) => {
    const target = (window as unknown as { __kpcPerf: Record<string, (...a: unknown[]) => Promise<unknown>> }).__kpcPerf;
    return target[name as string](...(params as unknown[]));
  }, [fn, args] as const) as Promise<T>;
}

test("@perf frontend measurements", async ({ browser }) => {
  test.setTimeout(300_000);
  const results: Record<string, unknown> = { measured_at: new Date().toISOString(), base_url: process.env.E2E_BASE_URL };
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Initial load with an empty cache.
  let start = Date.now();
  await page.goto("/");
  await expect(page.getByLabel("KPC email")).toBeVisible();
  results.initial_load_to_login_ms = Date.now() - start;
  results.initial_navigation = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return {
      dom_content_loaded_ms: Math.round(nav.domContentLoadedEventEnd),
      load_event_ms: Math.round(nav.loadEventEnd),
      transferred_kib: Math.round((nav.transferSize + resources.reduce((sum, item) => sum + item.transferSize, 0)) / 1024),
    };
  });

  // Sign in, let the service worker take control and the offline caches fill.
  await page.evaluate(() => localStorage.setItem("kpc-perf", "1"));
  await signIn(page, "automation");
  await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.goto("/faults?mode=history");
  await expect(page.getByRole("heading", { name: "Breakdowns" })).toBeVisible();
  const rows = page.locator("tbody tr");
  const opened = Math.min(5, await rows.count());
  for (let index = 0; index < opened; index += 1) {
    await rows.nth(index).click();
    await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
  }
  await page.waitForTimeout(1500); // background cache refresh after sign-in

  // 2. Cached application launch, fully offline (service worker + IndexedDB), and online.
  const launches = async (offline: boolean) => {
    await context.setOffline(offline);
    const samples: number[] = [];
    for (let run = 0; run < 8; run += 1) {
      start = Date.now();
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
      samples.push(Date.now() - start);
    }
    await context.setOffline(false);
    return stats(samples);
  };
  results.cached_launch_offline_ms = await launches(true);
  results.cached_launch_online_ms = await launches(false);

  // 3. Local equipment search over the seeded registry plus 2,000 synthetic rows.
  results.equipment_rows_on_device = await probe<number>(page, "seedEquipment", 2000);
  const searchSamples: Record<string, number[]> = { tag_prefix: [], text_match: [], no_match: [] };
  for (let run = 0; run < 25; run += 1) {
    searchSamples.tag_prefix.push((await probe<{ ms: number }>(page, "searchEquipment", "PERF-01")).ms);
    searchSamples.text_match.push((await probe<{ ms: number }>(page, "searchEquipment", "bay 17")).ms);
    searchSamples.no_match.push((await probe<{ ms: number }>(page, "searchEquipment", "zzzz-none")).ms);
  }
  results.local_equipment_search_ms = Object.fromEntries(Object.entries(searchSamples).map(([key, values]) => [key, stats(values)]));

  // 4. Local fault history (cached investigation) retrieval.
  const faultIds = await probe<string[]>(page, "cachedFaultIds");
  const historySamples: number[] = [];
  for (let run = 0; run < 50; run += 1) {
    historySamples.push((await probe<{ ms: number }>(page, "faultHistory", faultIds[run % faultIds.length])).ms);
  }
  results.cached_investigations = faultIds.length;
  results.local_fault_history_ms = stats(historySamples);

  // 5. Local persistence of an offline change (outbox write, including sequence counter transaction).
  const persistSamples: number[] = [];
  for (let run = 0; run < 50; run += 1) persistSamples.push((await probe<{ ms: number }>(page, "persistEvent")).ms);
  results.local_persistence_ms = stats(persistSamples);

  await probe(page, "clearSeed");
  await page.evaluate(() => localStorage.removeItem("kpc-perf"));
  await context.close();

  fs.mkdirSync("perf-results", { recursive: true });
  fs.writeFileSync("perf-results/frontend.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
});
