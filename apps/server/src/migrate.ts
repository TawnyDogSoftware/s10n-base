import { runMigrateCli } from "./migrate-cli";

process.exitCode = await runMigrateCli({ args: process.argv.slice(2), env: process.env });
