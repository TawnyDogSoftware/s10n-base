/** Checks the server bundle imports exactly its declared packages: see bundle-imports.ts. */
import { bundleImportsCommand } from "./bundle-imports";

process.exitCode = await bundleImportsCommand(process.argv.slice(2), console);
