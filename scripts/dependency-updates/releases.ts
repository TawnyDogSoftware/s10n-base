import { compareVersions } from "./semver";

const MIN_RELEASE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface GitHubRelease {
  readonly tag_name: string;
  readonly published_at: string | null;
  readonly prerelease: boolean;
  readonly draft: boolean;
}

export interface NodeIndexEntry {
  readonly version: string;
  readonly date: string;
  readonly lts: string | false;
}

function newest(versions: readonly string[]): string | undefined {
  return [...versions].toSorted(compareVersions).at(-1);
}

/** The newest stable bun release (tag `bun-vX.Y.Z`) published at least 3 days before `now`. */
export function pickBunRelease(releases: readonly GitHubRelease[], now: Date): string | undefined {
  const eligible = releases.flatMap((release) => {
    const version = /^bun-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
    if (
      version === undefined ||
      release.prerelease ||
      release.draft ||
      release.published_at === null
    ) {
      return [];
    }
    const age = now.getTime() - Date.parse(release.published_at);
    return age >= MIN_RELEASE_AGE_MS ? [version] : [];
  });
  return newest(eligible);
}

/**
 * The newest Node release on `major` that is at least 3 days old, and the newest LTS
 * major above it, if there is one (reported, never applied). nodejs.org gives only a
 * date, so a release counts from the end of that day.
 */
export function pickNodeRelease(
  index: readonly NodeIndexEntry[],
  major: number,
  now: Date,
): { version: string | undefined; newerLtsMajor: number | undefined } {
  const eligible = index.flatMap((entry) => {
    const version = /^v(\d+\.\d+\.\d+)$/.exec(entry.version)?.[1];
    const published = Date.parse(`${entry.date}T23:59:59.999Z`);
    // A date that does not parse gives NaN, and NaN is never below the minimum age.
    const oldEnough = Number.isFinite(published) && now.getTime() - published >= MIN_RELEASE_AGE_MS;
    if (version === undefined || !oldEnough) return [];
    return [{ version, major: Number(version.split(".")[0]), lts: entry.lts !== false }];
  });
  const ltsMajors = eligible
    .filter((entry) => entry.lts && entry.major > major)
    .map((entry) => entry.major);
  return {
    version: newest(
      eligible.filter((entry) => entry.major === major).map((entry) => entry.version),
    ),
    newerLtsMajor: ltsMajors.length === 0 ? undefined : Math.max(...ltsMajors),
  };
}
