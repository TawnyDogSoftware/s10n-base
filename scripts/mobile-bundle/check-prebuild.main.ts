/** `bun scripts/mobile-bundle/check-prebuild.main.ts [appRoot] [variant]`: see check-prebuild.ts. */
import { checkPrebuildCommand } from "./check-prebuild";

process.exitCode = checkPrebuildCommand(process.argv.slice(2), console);
