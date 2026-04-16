import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "cjs",
  outDir: "dist-electron",
  sourcemap: true,
  clean: true,
  outExtensions: () => ({ js: ".js" }),
});
