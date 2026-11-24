import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkUnavailableError, connectionState, networkFetch, setNetworkMode, setRandomSource } from "./network";

afterEach(() => {
  setNetworkMode("online");
  setRandomSource(Math.random);
  vi.unstubAllGlobals();
});

describe("network simulator", () => {
  it("blocks requests in offline mode without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setNetworkMode("offline");
    await expect(networkFetch("http://api/x")).rejects.toBeInstanceOf(NetworkUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectionState().online).toBe(false);
  });

  it("drops some requests in intermittent mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    setNetworkMode("intermittent");
    setRandomSource(() => 0.1); // below the failure rate: dropped
    await expect(networkFetch("http://api/x")).rejects.toBeInstanceOf(NetworkUnavailableError);
    setRandomSource(() => 0.9); // above it: delivered
    await expect(networkFetch("http://api/x")).resolves.toBeInstanceOf(Response);
  });

  it("maps a real fetch failure to NetworkUnavailableError and marks the server unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(networkFetch("http://api/x")).rejects.toBeInstanceOf(NetworkUnavailableError);
    expect(connectionState().serverReachable).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await networkFetch("http://api/x");
    expect(connectionState().serverReachable).toBe(true);
  });
});
