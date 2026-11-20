import { runSetRoleCli } from "./set-role-cli";

process.exitCode = await runSetRoleCli({ args: process.argv.slice(2), env: process.env });
