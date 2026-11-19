/**
 * `bun run ses:local`: runs the local SES capture server on the host and port of `SES_ENDPOINT`
 * (from `.env`, or `.env.example`), until Ctrl-C. The inbox is at that address.
 */
import { startSesLocal } from "./server";

/**
 * Where to listen, from `SES_ENDPOINT`.
 *
 * @throws {Error} when it is unset or not an http URL with a port.
 */
export function listenAddress(endpoint: string | undefined): { host: string; port: number } {
  const url = endpoint === undefined || endpoint === "" ? null : URL.parse(endpoint);
  if (url === null || url.protocol !== "http:" || url.port === "") {
    throw new Error(
      "SES_ENDPOINT must be set to the capture server's address, such as http://127.0.0.1:8005.",
    );
  }
  return { host: url.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(url.port) };
}

async function main() {
  const { host, port } = listenAddress(process.env.SES_ENDPOINT);
  const local = await startSesLocal({ host, port });
  console.log(`ses-local: capturing SES email at ${local.url}; inbox: ${local.url}/`);
  const stop = () => {
    void local.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`ses-local: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
