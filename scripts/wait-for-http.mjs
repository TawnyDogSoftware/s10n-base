const [url] = process.argv.slice(2);

if (!url) {
  throw new Error("Usage: node scripts/wait-for-http.mjs <url>");
}

const startedAt = Date.now();
const timeoutMs = 20_000;

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      process.exit(0);
    }
  } catch {
    // Retry.
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
}

throw new Error(`Timed out waiting for ${url}`);
