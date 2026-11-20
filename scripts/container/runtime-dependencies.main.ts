/** Copies the server's run-time packages out of a production install: see runtime-dependencies.ts. */
import { runtimeDependenciesCommand } from "./runtime-dependencies";

process.exitCode = await runtimeDependenciesCommand(process.argv.slice(2), console);
