import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 for the few request shapes the storage
 * adapter needs (`PUT`, `GET`, `HEAD`, `DELETE` object).
 *
 * Scope note: this signs a request with no query string and a small, fixed set
 * of headers. It is deliberately not a general-purpose signer, and it is not
 * used by any code path that is verified in this repository: the S3 adapter is
 * installed but unconfigured until someone supplies bucket credentials and
 * runs it against a real bucket (see docs/runbooks/object-storage.md).
 */

const ALGORITHM = "AWS4-HMAC-SHA256";

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function amzDate(now: Date): { full: string; short: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { full: iso, short: iso.slice(0, 8) };
}

/** RFC 3986 encoding for each path segment, keeping separators unrelated to encoding. */
function canonicalUri(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  searchParams.forEach((value, key) => pairs.push([key, value]));
  pairs.sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? (aValue < bValue ? -1 : 1) : aKey < bKey ? -1 : 1,
  );
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export type SignAwsRequestInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  url: URL;
  /** Headers to include in the signature. `host` is added automatically. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the request body; the empty-body hash for GET/HEAD/DELETE. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  now?: Date | undefined;
};

export const EMPTY_PAYLOAD_HASH = sha256Hex("");

/**
 * Returns the headers to send, including `Authorization`. The caller must send
 * exactly these headers: adding or editing a signed header invalidates the
 * signature.
 */
export function signAwsRequest(input: SignAwsRequestInput): Record<string, string> {
  const { full: amzWhen, short: dateStamp } = amzDate(input.now ?? new Date());

  const headers: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzWhen,
    ...input.headers,
  };
  if (input.sessionToken) headers["x-amz-security-token"] = input.sessionToken;

  const sortedHeaders = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const canonicalHeaders = sortedHeaders.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = sortedHeaders.map(([name]) => name).join(";");

  const canonicalRequest = [
    input.method,
    canonicalUri(input.url.pathname),
    canonicalQuery(input.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzWhen, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), input.service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization: `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
