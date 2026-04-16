import { startServer } from "./server";

async function main() {
  const started = await startServer();
  console.info(`S10N Base server listening on http://${started.config.host}:${started.port}`);
}

void main();
