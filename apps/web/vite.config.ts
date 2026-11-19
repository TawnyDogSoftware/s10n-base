import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverUrl = process.env.VITE_SERVER_URL?.trim() || "http://127.0.0.1:4210";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: process.env.HOST?.trim() || "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/config": serverUrl,
      "/health": serverUrl,
      "/rpc": serverUrl,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
