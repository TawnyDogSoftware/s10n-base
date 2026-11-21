import path from "node:path";

/**
 * The built web app. This module sits directly in `src/`, and the bundle in `dist/`, both one
 * level below `apps/server`, so the same relative path works from source and from the build.
 * Do not move it deeper: `bun run smoke` checks that the built server serves the web app.
 */
export const WEB_DIST_DIR = path.resolve(import.meta.dirname, "../../web/dist");
