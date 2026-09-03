import crypto from "node:crypto";

/** Constant-time token compare. Length mismatch still fails after a dummy compare. */
export function tokenEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(String(provided ?? ""), "utf8");
  const b = Buffer.from(String(expected ?? ""), "utf8");
  if (a.length === b.length) {
    if (a.length === 0) return expected === "" && provided === "";
    return crypto.timingSafeEqual(a, b);
  }
  if (b.length > 0) crypto.timingSafeEqual(b, b);
  else if (a.length > 0) crypto.timingSafeEqual(a, a);
  return false;
}

/**
 * Native host and local tools typically send no Origin. Reject random web origins
 * so a browser page cannot drive the /host WebSocket even if it learns the token.
 */
export function isAllowedWsOrigin(origin: string | undefined | null): boolean {
  if (origin == null || origin === "" || origin === "null") return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  return false;
}

export function bearerToken(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return "";
  if (!raw.toLowerCase().startsWith("bearer ")) return "";
  return raw.slice(7).trim();
}
