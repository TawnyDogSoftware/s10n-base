import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { webDevServer } from "@s10n-base/shared/web-dev-server";

import { readApiBaseUrl } from "./src/config.ts";

// In development APP_URL is the origin the browser opens: Vite, which proxies the API paths to
// the server, either directly or behind an https forwarder. Where Vite listens follows from it
// (web-dev-server.ts), unless WEB_DEV_HOST and WEB_DEV_PORT say otherwise.
const appUrl = new URL(process.env.APP_URL?.trim() || "http://localhost:5173");
const listen = webDevServer(process.env);
// Fails the build, not the page, when VITE_API_BASE_URL is set to anything but a bare origin.
readApiBaseUrl({ VITE_API_BASE_URL: process.env.VITE_API_BASE_URL }, appUrl.origin);
const serverUrl =
  process.env.VITE_SERVER_URL?.trim() || `http://127.0.0.1:${process.env.PORT?.trim() || "4210"}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: listen.host,
    port: listen.port,
    strictPort: true,
    allowedHosts: [...listen.allowedHosts],
    proxy: {
      "/api": serverUrl,
      "/config": serverUrl,
      "/health": serverUrl,
      "/ready": serverUrl,
      "/rpc": serverUrl,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
