/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser calls same-origin /api/...; the dev/preview server forwards it to
// the backend. Set VITE_PROXY_TARGET when the API is elsewhere (Compose uses
// http://backend:8000).
const apiProxy = {
  "/api": { target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8000", changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  // "frontend" is the Compose service name used by the Playwright container.
  server: { port: 5173, proxy: apiProxy, allowedHosts: ["frontend"] },
  preview: { port: 4173, proxy: apiProxy },
  test: {
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
