/**
 * Site-access policy used by the service worker and unit tests.
 * Public HTTP(S) sites are allowed by default. Loopback, RFC1918, link-local,
 * and cloud-metadata addresses are denied. chrome:/devtools: are not auto-allowed.
 */

const EXTENSION_ID = "pikkhapdmpoooagfjiogpjaleapphnmh";

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
  "github.io",
  "herokuapp.com",
  "appspot.com",
  "pages.dev",
  "vercel.app",
  "netlify.app",
  "azurewebsites.net",
  "cloudfront.net",
  "s3.amazonaws.com",
]);

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "kubernetes.default",
  "kubernetes.default.svc",
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
  if (h.includes(":")) return h;
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 1) return h;
  if (parts.length === 2) return h;
  const last3 = parts.slice(-3).join(".");
  if (MULTI_PART_TLDS.has(last3) && parts.length >= 4) {
    return parts.slice(-4).join(".");
  }
  const last2 = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return last2;
}

function ipv4Octets(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const oct = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (oct.some((n) => n > 255)) return null;
  return oct;
}

function ipv6FirstGroup(h) {
  const first = h.split(":")[0];
  if (!first) return NaN;
  return parseInt(first.padEnd(4, "0"), 16);
}

export function isPrivateOrSpecialHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0") return true;
  if (METADATA_HOSTS.has(h)) return true;
  const v4mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4mapped) return isPrivateOrSpecialHost(v4mapped[1]);
  const v4 = ipv4Octets(h);
  if (v4) {
    const [a, b] = v4;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
    const n = ipv6FirstGroup(h);
    if (!Number.isNaN(n)) {
      if ((n & 0xfe00) === 0xfc00) return true;
      if ((n & 0xffc0) === 0xfe80) return true;
    }
    if (h === "fd00:ec2::254") return true;
    return false;
  }
  return false;
}

function isTightInternalAllow(u) {
  if (u.protocol === "about:") {
    const href = u.href.split("#")[0].split("?")[0];
    if (href === "about:blank" || u.pathname === "blank") return true;
    return false;
  }
  if (u.protocol === "chrome-extension:" && u.hostname === EXTENSION_ID) return true;
  return false;
}

export function domainForUrl(raw) {
  const u = parseUrl(raw);
  if (!u) return { ok: false, internal: false, domain: "", hostname: "", protocol: "", reason: "invalid" };
  if (isTightInternalAllow(u)) {
    return {
      ok: true,
      internal: true,
      domain: u.protocol === "about:" ? "about" : u.hostname,
      hostname: u.hostname.toLowerCase(),
      protocol: u.protocol,
    };
  }
  if (
    u.protocol === "chrome:" ||
    u.protocol === "chrome-extension:" ||
    u.protocol === "chrome-untrusted:" ||
    u.protocol === "devtools:" ||
    u.protocol === "edge:" ||
    u.protocol === "brave:" ||
    u.protocol === "opera:" ||
    u.protocol === "about:"
  ) {
    return {
      ok: false,
      internal: true,
      domain: u.protocol.replace(":", ""),
      hostname: u.hostname.toLowerCase(),
      protocol: u.protocol,
      reason: "internal_not_allowlisted",
    };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return {
      ok: false,
      internal: false,
      domain: "",
      hostname: u.hostname.toLowerCase(),
      protocol: u.protocol,
      reason: "invalid_or_unsupported_url",
    };
  }
  const host = u.hostname.toLowerCase();
  const domain = registrableDomain(host);
  if (isPrivateOrSpecialHost(host)) {
    return {
      ok: false,
      internal: false,
      domain,
      hostname: host,
      protocol: u.protocol,
      reason: "private_or_internal_host",
    };
  }
  return { ok: true, internal: false, domain, hostname: host, protocol: u.protocol };
}

function denyKeyMatchesHost(key, hostname, domain) {
  const k = String(key || "").toLowerCase();
  if (!k) return false;
  if (k === hostname || k === domain) return true;
  if (hostname === k || hostname.endsWith("." + k)) return true;
  return false;
}

function lookupStored(stored, hostname, domain) {
  if (!stored) return null;
  if (hostname && stored[hostname]?.decision) return stored[hostname].decision;
  if (domain && stored[domain]?.decision) return stored[domain].decision;
  for (const key of Object.keys(stored)) {
    if (stored[key]?.decision !== "deny") continue;
    if (denyKeyMatchesHost(key, hostname, domain)) return "deny";
  }
  return null;
}

/**
 * @param {object} input
 * @param {string} input.url
 * @param {Record<string, { decision: 'allow' | 'deny' }>} input.stored
 * @param {Set<string>} input.once
 */
export function evaluatePolicy(input) {
  const parsed = domainForUrl(input.url);
  const hostname = parsed.hostname || "";
  const domain = parsed.domain || "";
  if (!parsed.ok) {
    if (parsed.reason === "private_or_internal_host") {
      return { action: "deny", domain, hostname, reason: "private_or_internal_host" };
    }
    if (parsed.reason === "internal_not_allowlisted") {
      return { action: "deny", domain, hostname, reason: "internal_not_allowlisted" };
    }
    return { action: "deny", domain: domain || "", hostname, reason: parsed.reason || "invalid_or_unsupported_url" };
  }
  if (parsed.internal) {
    return { action: "proceed", domain, hostname, reason: "internal" };
  }
  if (!domain && !hostname) {
    return { action: "deny", domain: "", hostname, reason: "missing_domain" };
  }
  if (input.once && (input.once.has(domain) || (hostname && input.once.has(hostname)))) {
    return { action: "proceed", domain, hostname, reason: "allow_once" };
  }
  const decision = lookupStored(input.stored, hostname, domain);
  if (decision === "allow") {
    return { action: "proceed", domain, hostname, reason: "allow_site" };
  }
  if (decision === "deny") {
    return { action: "deny", domain, hostname, reason: "deny_site" };
  }
  return { action: "proceed", domain, hostname, reason: "default_allow" };
}

export function applyDecision(state, domain, decision, hostname) {
  const stored = { ...(state.stored || {}) };
  const once = new Set(state.once || []);
  const keys = [...new Set([domain, hostname].filter(Boolean).map((s) => String(s).toLowerCase()))];
  if (decision === "allow") {
    for (const key of keys) {
      stored[key] = { decision: "allow" };
      once.delete(key);
    }
  } else if (decision === "deny") {
    for (const key of keys) {
      stored[key] = { decision: "deny" };
      once.delete(key);
    }
  } else if (decision === "allow-once") {
    for (const key of keys) once.add(key);
  }
  return { stored, once };
}

export function filterListedTabs(tabs, stored, once) {
  return (tabs || []).filter((tab) => {
    if (!tab || !tab.url) return true;
    return evaluatePolicy({ url: tab.url, stored, once }).action === "proceed";
  });
}
