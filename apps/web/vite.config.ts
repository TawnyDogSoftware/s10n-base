import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { readApiBaseUrl } from "./src/config";

// In development APP_URL is this dev server's origin: the browser talks to Vite, which proxies
// the API paths to the server. So the dev server listens on APP_URL's host and port.
const appUrl = new URL(process.env.APP_URL?.trim() || "http://localhost:5173");
// Fails the build, not the page, when VITE_API_BASE_URL is set to anything but a bare origin.
readApiBaseUrl({ VITE_API_BASE_URL: process.env.VITE_API_BASE_URL }, appUrl.origin);
const serverUrl =
  process.env.VITE_SERVER_URL?.trim() || `http://127.0.0.1:${process.env.PORT?.trim() || "4210"}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: appUrl.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(appUrl.port || (appUrl.protocol === "https:" ? 443 : 80)),
    strictPort: true,
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
