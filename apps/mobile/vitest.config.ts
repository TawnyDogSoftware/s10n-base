import path from "node:path";

import { uniwind } from "uniwind/vite";
import { defineConfig } from "vitest/config";

// Uniwind resolves its paths from the working directory, which is the repo root when the root
// config runs every project, and this directory when the app's own `bun run test` does.
const fromHere = (file: string) =>
  path.relative(process.cwd(), path.join(import.meta.dirname, file));

export default defineConfig({
  // Uniwind's plugin points `react-native` at its web components over react-native-web, so the
  // screens render in jsdom with their class names applied.
  plugins: [
    uniwind({
      cssEntryFile: fromHere("src/global.css"),
      dtsFile: fromHere("src/uniwind-types.d.ts"),
    }),
  ],
  define: { __DEV__: "true" },
  resolve: {
    extensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js", ".mjs", ".json"],
  },
  test: {
    name: "mobile",
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    // Packages that import `react-native` must go through Vite, so it resolves to
    // react-native-web through Uniwind's alias rather than to the native package.
    server: { deps: { inline: [/uniwind/, /@better-auth\/expo/] } },
  },
});
