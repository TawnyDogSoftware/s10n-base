import { defineConfig } from "tsdown";

export default defineConfig({
  // The server, and the migrate entry point that runs separately (the server never migrates).
  entry: ["src/bin.ts", "src/migrate.ts"],
  format: ["esm"],
  // The entry is a program, not a library. Without this, tsdown emits declarations
  // because `composite` in tsconfig.json implies `declaration`.
  dts: false,
  clean: true,
  outDir: "dist",
  // Workspace packages export TypeScript source, which Node cannot load from
  // `node dist/bin.mjs`, so they are bundled into the build.
  deps: { alwaysBundle: [/^@s10n-base\//] },
});
