/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The browser calls same-origin /api/...; the dev/preview server forwards it to
// the backend. Set VITE_PROXY_TARGET when the API is elsewhere (Compose uses
// http://backend:8000).
const apiProxy = {
  "/api": { target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8000", changeOrigin: true },
};
// "frontend" is the Compose service name used by the Playwright container.
const allowedHosts = ["frontend"];

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false, // registered in app/pwa.ts
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "KPC Maintenance Intelligence (synthetic demo)",
        short_name: "KPC Maintenance",
        description: "Fault tracking and maintenance knowledge prototype. Illustrative data only.",
        theme_color: "#12324a",
        background_color: "#e9eef2",
        display: "standalone",
        start_url: "/dashboard",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, proxy: apiProxy, allowedHosts },
  preview: { port: 4173, proxy: apiProxy, allowedHosts },
  build: { sourcemap: false },
  test: {
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
