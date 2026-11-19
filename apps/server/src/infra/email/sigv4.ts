/**
 * AWS Signature Version 4 on `node:crypto`, for the SES sender and the local capture server.
 * Header-based signing only (no presigned URLs). Verified against the AWS test suite in
 * `sigv4-test-suite/` (see its README for where it comes from).
 *
 * The steps: a canonical request (method, path, query, signed headers, payload hash), a string to
 * sign over its hash, and an HMAC-SHA256 chain from the secret key through the date, region,
 * service and `aws4_request` to the signing key.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string | undefined;
}

/** A request as it goes on the wire: the path and query exactly as sent, without the `?`. */
export interface SignableRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  /** Header names in any case. Repeated names are allowed. Must include `host`. */
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: string | Uint8Array;
}

export interface SigningOptions {
  readonly credentials: AwsCredentials;
  readonly region: string;
  readonly service: string;
  readonly date: Date;
  /** Remove `.` and `..` segments and repeated slashes before encoding. Default true. */
  readonly normalizePath?: boolean;
  /** Add and sign `x-amz-content-sha256`. Default false. */
  readonly signBody?: boolean;
  /** Sign `x-amz-security-token`, rather than adding it after signing. Default true. */
  readonly signSessionToken?: boolean;
}

export interface SignatureParts {
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly signature: string;
  readonly signedHeaders: string;
}

export interface SignedRequest extends SignatureParts {
  /** The headers to add to the request, lower-case: `x-amz-date`, `authorization` and others. */
  readonly headers: Readonly<Record<string, string>>;
}

const ALGORITHM = "AWS4-HMAC-SHA256";

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Percent-encodes every byte except the unreserved characters `A-Z a-z 0-9 - . _ ~`. */
function uriEncode(value: string): string {
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    encoded += /[A-Za-z0-9\-._~]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

function normalizeSegments(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}${path.endsWith("/") ? "/" : ""}`;
}

/**
 * The canonical URI: each segment of the path as sent, encoded once more. Outside S3, AWS signs
 * the encoding of the already-encoded path, so `/a%20b` is signed as `/a%2520b`.
 */
function canonicalPath(path: string, normalize: boolean): string {
  const source = path === "" ? "/" : path;
  const resolved = normalize ? normalizeSegments(source) : source;
  return resolved.split("/").map(uriEncode).join("/");
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The canonical query: every parameter decoded, encoded once, and sorted by key then value. */
/** AWS sorts by code unit (byte order for ASCII), not by locale. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : Number(left > right);
}

function canonicalQuery(query: string): string {
  return query
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const key = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? "" : pair.slice(equals + 1);
      return [uriEncode(decodeComponent(key)), uriEncode(decodeComponent(value))] as const;
    })
    .toSorted(
      ([keyA, valueA], [keyB, valueB]) =>
        compareCodeUnits(keyA, keyB) || compareCodeUnits(valueA, valueB),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** Lower-case names, values trimmed with inner whitespace collapsed, repeats joined by commas. */
function canonicalHeaders(headers: SignableRequest["headers"]): Map<string, string> {
  const byName = new Map<string, string[]>();
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    const values = byName.get(key) ?? [];
    values.push(value.trim().replace(/\s+/g, " "));
    byName.set(key, values);
  }
  return new Map(
    [...byName.entries()]
      .toSorted(([a], [b]) => compareCodeUnits(a, b))
      .map(([name, values]) => [name, values.join(",")]),
  );
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  return hmac(hmac(hmac(dateKey, region), service), "aws4_request");
}

/** `20261119T120000Z` for a date. */
function toAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Computes the signature over `request`, signing every header it has. `amzDate` must equal the
 * request's `x-amz-date` header.
 *
 * @throws {Error} when the request has no `host` header.
 */
export function computeSignature(
  request: SignableRequest,
  options: {
    readonly credentials: Pick<AwsCredentials, "secretAccessKey" | "accessKeyId">;
    readonly region: string;
    readonly service: string;
    readonly amzDate: string;
    readonly normalizePath?: boolean;
  },
): SignatureParts {
  const headers = canonicalHeaders(request.headers);
  if (!headers.has("host")) throw new Error("A SigV4 request must have a host header.");
  const signedHeaders = [...headers.keys()].join(";");
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(request.path, options.normalizePath ?? true),
    canonicalQuery(request.query),
    ...[...headers.entries()].map(([name, value]) => `${name}:${value}`),
    "",
    signedHeaders,
    sha256Hex(request.body),
  ].join("\n");
  const dateStamp = options.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = [ALGORITHM, options.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = signingKey(
    options.credentials.secretAccessKey,
    dateStamp,
    options.region,
    options.service,
  );
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
  return { canonicalRequest, stringToSign, signature, signedHeaders };
}

/**
 * Signs a request: adds `x-amz-date`, the session token and (if asked) the payload hash, signs
 * every header, and returns the headers to send with it.
 *
 * @throws {Error} when the request has no `host` header.
 */
export function signRequest(request: SignableRequest, options: SigningOptions): SignedRequest {
  const amzDate = toAmzDate(options.date);
  const added: Record<string, string> = { "x-amz-date": amzDate };
  if (options.signBody === true) added["x-amz-content-sha256"] = sha256Hex(request.body);
  const token = options.credentials.sessionToken;
  const signToken = options.signSessionToken ?? true;
  if (token !== undefined && signToken) added["x-amz-security-token"] = token;

  const parts = computeSignature(
    { ...request, headers: [...request.headers, ...Object.entries(added)] },
    {
      credentials: options.credentials,
      region: options.region,
      service: options.service,
      amzDate,
      normalizePath: options.normalizePath ?? true,
    },
  );
  const scope = `${amzDate.slice(0, 8)}/${options.region}/${options.service}/aws4_request`;
  added.authorization = `${ALGORITHM} Credential=${options.credentials.accessKeyId}/${scope}, SignedHeaders=${parts.signedHeaders}, Signature=${parts.signature}`;
  if (token !== undefined && !signToken) added["x-amz-security-token"] = token;
  return { ...parts, headers: added };
}

export type VerifyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "missing_authorization"
        | "malformed_authorization"
        | "unknown_access_key"
        | "clock_skew"
        | "signature_mismatch";
    };

const AUTHORIZATION =
  /^AWS4-HMAC-SHA256 Credential=([^/\s]+)\/(\d{8})\/([^/\s]+)\/([^/\s]+)\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/;
const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function headerValue(request: SignableRequest, name: string): string | undefined {
  return request.headers.find(([key]) => key.toLowerCase() === name)?.[1];
}

interface SignedClaims {
  readonly accessKeyId: string;
  readonly region: string;
  readonly service: string;
  readonly signedNames: readonly string[];
  readonly signature: string;
  readonly amzDate: string;
  readonly signedAt: number;
}

type ClaimsResult =
  | { readonly ok: true; readonly claims: SignedClaims }
  | Extract<VerifyResult, { ok: false }>;

const MALFORMED = { ok: false, reason: "malformed_authorization" } as const;

/** The parts of an `Authorization` header, or null when it is not a SigV4 header. */
function parseAuthorization(authorization: string) {
  const parsed = AUTHORIZATION.exec(authorization.trim());
  if (parsed === null) return null;
  const [
    ,
    accessKeyId = "",
    dateStamp = "",
    region = "",
    service = "",
    signedList = "",
    signature = "",
  ] = parsed;
  return { accessKeyId, dateStamp, region, service, signedNames: signedList.split(";"), signature };
}

/** The time an `X-Amz-Date` value names, in milliseconds, or null when it is malformed. */
function parseAmzDate(amzDate: string): number | null {
  const parts = AMZ_DATE.exec(amzDate);
  if (parts === null) return null;
  const [, year = 0, month = 1, day, hour, minute, second] = parts.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** What the request's `Authorization` and `X-Amz-Date` headers claim, if they are well formed. */
function readClaims(request: SignableRequest): ClaimsResult {
  const authorization = headerValue(request, "authorization");
  if (authorization === undefined) return { ok: false, reason: "missing_authorization" };
  const parsed = parseAuthorization(authorization);
  const amzDate = headerValue(request, "x-amz-date")?.trim() ?? "";
  const signedAt = parseAmzDate(amzDate);
  if (parsed === null || signedAt === null) return MALFORMED;
  if (parsed.dateStamp !== amzDate.slice(0, 8) || !parsed.signedNames.includes("host")) {
    return MALFORMED;
  }
  return { ok: true, claims: { ...parsed, amzDate, signedAt } };
}

/**
 * Checks a signed request against known credentials: the access key, a date within
 * `maxSkewMs` of `now` (15 minutes by default, as AWS allows), and the signature over the headers
 * the request says it signed.
 */
export function verifySignature(
  request: SignableRequest,
  options: {
    readonly credentials: Pick<AwsCredentials, "accessKeyId" | "secretAccessKey">;
    readonly now: Date;
    readonly maxSkewMs?: number;
  },
): VerifyResult {
  const read = readClaims(request);
  if (!read.ok) return read;
  const { claims } = read;
  if (claims.accessKeyId !== options.credentials.accessKeyId) {
    return { ok: false, reason: "unknown_access_key" };
  }
  if (Math.abs(options.now.getTime() - claims.signedAt) > (options.maxSkewMs ?? 15 * 60 * 1000)) {
    return { ok: false, reason: "clock_skew" };
  }
  const headers = request.headers.filter(([name]) =>
    claims.signedNames.includes(name.toLowerCase()),
  );
  if (new Set(headers.map(([name]) => name.toLowerCase())).size !== claims.signedNames.length) {
    return MALFORMED;
  }
  const expected = computeSignature(
    { ...request, headers },
    {
      credentials: options.credentials,
      region: claims.region,
      service: claims.service,
      amzDate: claims.amzDate,
    },
  ).signature;
  const matches = timingSafeEqual(Buffer.from(expected), Buffer.from(claims.signature));
  return matches ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}
