/**
 * Site-access policy used by the service worker and unit tests.
 * First visit to a new registrable domain → prompt Allow once / Allow site / Deny.
 */

const MULTI_PART_TLDS = new Set([
  "ac.uk",
  "co.uk",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "org.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "org.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.br",
  "com.mx",
  "co.in",
  "com.cn",
  "com.hk",
  "co.kr",
  "com.tw",
  "co.za",
  "com.sg",
  "co.id",
  "com.ar",
  "com.tr",
]);

const INTERNAL_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "about:",
  "devtools:",
  "edge:",
  "brave:",
  "opera:",
]);

export function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function hostnameOf(raw) {
  const u = parseUrl(raw);
  if (!u) return "";
  return u.hostname.toLowerCase();
}

export function registrableDomain(hostname) {
  if (!hostname) return "";
  const h = String(hostname).toLowerCase().replace(/\.$/, "");
  if (!h) return "";
  if (h === "localhost") return "localhost";
  if (h.endsWith(".localhost")) return "localhost";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return h;
  if (h.includes(":")) return h; // IPv6-like
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 1) return h;
  if (parts.length === 2) return h;
  const last2 = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return last2;
}

export function domainForUrl(raw) {
  const u = parseUrl(raw);
  if (!u) return { ok: false, internal: false, domain: "", protocol: "" };
  if (INTERNAL_PROTOCOLS.has(u.protocol)) {
    return { ok: true, internal: true, domain: u.protocol.replace(":", ""), protocol: u.protocol };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, internal: false, domain: "", protocol: u.protocol };
  }
  const host = u.hostname.toLowerCase();
  return { ok: true, internal: false, domain: registrableDomain(host), protocol: u.protocol };
}

/**
 * @param {object} input
 * @param {string} input.url
 * @param {Record<string, { decision: 'allow' | 'deny' }>} input.stored
 * @param {Set<string>} input.once
 */
export function evaluatePolicy(input) {
  const parsed = domainForUrl(input.url);
  if (!parsed.ok) {
    return { action: "deny", domain: "", reason: "invalid_or_unsupported_url" };
  }
  if (parsed.internal) {
    return { action: "proceed", domain: parsed.domain, reason: "internal" };
  }
  const domain = parsed.domain;
  if (!domain) {
    return { action: "deny", domain: "", reason: "missing_domain" };
  }
  if (input.once && input.once.has(domain)) {
    return { action: "proceed", domain, reason: "allow_once" };
  }
  const stored = input.stored?.[domain];
  if (stored?.decision === "allow") {
    return { action: "proceed", domain, reason: "allow_site" };
  }
  if (stored?.decision === "deny") {
    return { action: "deny", domain, reason: "deny_site" };
  }
  return { action: "prompt", domain, reason: "unknown_site" };
}

export function applyDecision(state, domain, decision) {
  const stored = { ...(state.stored || {}) };
  const once = new Set(state.once || []);
  if (decision === "allow") {
    stored[domain] = { decision: "allow" };
    once.delete(domain);
  } else if (decision === "deny") {
    stored[domain] = { decision: "deny" };
    once.delete(domain);
  } else if (decision === "allow-once") {
    once.add(domain);
  }
  return { stored, once };
}
