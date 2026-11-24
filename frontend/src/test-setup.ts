import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";

// Node 18 lacks these browser globals (Node 20+ and browsers have them).
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
if (typeof globalThis.CustomEvent === "undefined") {
  class CustomEventPolyfill<T> extends Event {
    detail: T | null;
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type, init);
      this.detail = init?.detail ?? null;
    }
  }
  Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventPolyfill, configurable: true });
}
