/**
 * The AWS keys `.env.example` gives the server. The local capture server (`bun run ses:local`)
 * checks every request's signature against them, and production config refuses them.
 */
export const LOCAL_SES_CREDENTIALS = { accessKeyId: "local", secretAccessKey: "local" } as const;
