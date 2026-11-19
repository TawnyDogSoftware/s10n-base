/**
 * The opaque cursor of `admin.listUsers`: the `(created_at, id)` of the last user on a page, as
 * base64url JSON. The time keeps Postgres's microseconds, which a JavaScript `Date` would drop:
 * rounding to milliseconds could skip or repeat users created within the same millisecond.
 */

/** Where a page ended: the last user's creation time (UTC, microseconds) and id. */
export interface UserCursor {
  /** `YYYY-MM-DDTHH:MM:SS.ffffffZ`. */
  readonly createdAt: string;
  readonly id: string;
}

const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function encodeUserCursor(cursor: UserCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.createdAt, id: cursor.id })).toString("base64url");
}

function isRealTime(value: string): boolean {
  const parts = TIME.exec(value);
  if (parts === null) return false;
  const date = new Date(`${value.slice(0, 19)}Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

/** The position in a cursor this server issued, or `null` when it is not one. */
export function decodeUserCursor(cursor: string): UserCursor | null {
  if (!BASE64URL.test(cursor)) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  if (keys.length !== 2 || keys[0] !== "at" || keys[1] !== "id") return null;
  const { at, id } = record;
  if (typeof at !== "string" || typeof id !== "string") return null;
  if (!isRealTime(at) || !UUID.test(id)) return null;
  return { createdAt: at, id };
}
