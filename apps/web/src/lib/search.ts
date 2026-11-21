/**
 * Search-param parsing and writing for the router. TanStack Router's default parses each value
 * as JSON, so `?token=123456` arrives as the number 123456, and a token such as `1e5` or `007`
 * comes back changed. Every value here stays the string that was in the URL.
 *
 * A literal `+` is kept as `+` rather than read as a space: tokens are opaque, and the links we
 * write always percent-encode, so a `+` in a URL came from a token.
 */

export type SearchRecord = Record<string, string>;

function decode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/** Parses `?a=1&b=2` (the `?` is optional). The first of repeated keys wins. */
export function parseSearch(search: string): SearchRecord {
  const result: SearchRecord = Object.create(null) as SearchRecord;
  const query = search.startsWith("?") ? search.slice(1) : search;
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const separator = pair.indexOf("=");
    const key = decode(separator === -1 ? pair : pair.slice(0, separator));
    const value = decode(separator === -1 ? "" : pair.slice(separator + 1));
    if (key === undefined || value === undefined || Object.hasOwn(result, key)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Writes a search record as `?a=1&b=2`, percent-encoding every key and value; `""` when empty.
 *
 * @throws {Error} for a value that is not a string, number, boolean or undefined.
 */
export function stringifySearch(search: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`Search parameter "${key}" must be a string, number or boolean.`);
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** Reads an optional string search parameter for a route's `validateSearch`. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
