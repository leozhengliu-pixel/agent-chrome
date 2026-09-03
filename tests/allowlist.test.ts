import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDecision,
  domainForUrl,
  evaluatePolicy,
  filterListedTabs,
  isPrivateOrSpecialHost,
  registrableDomain,
} from "../extension/policy.js";

test("registrableDomain uses eTLD+1", () => {
  assert.equal(registrableDomain("www.example.com"), "example.com");
  assert.equal(registrableDomain("a.b.example.com"), "example.com");
  assert.equal(registrableDomain("example.com"), "example.com");
  assert.equal(registrableDomain("shop.foo.co.uk"), "foo.co.uk");
  assert.equal(registrableDomain("localhost"), "localhost");
  assert.equal(registrableDomain("app.localhost"), "localhost");
  assert.equal(registrableDomain("127.0.0.1"), "127.0.0.1");
});

test("registrableDomain treats github.io-style multi-part suffixes as eTLD+1", () => {
  assert.equal(registrableDomain("foo.github.io"), "foo.github.io");
  assert.equal(registrableDomain("bar.foo.github.io"), "foo.github.io");
  assert.equal(registrableDomain("app.herokuapp.com"), "app.herokuapp.com");
  assert.equal(registrableDomain("my.appspot.com"), "my.appspot.com");
  assert.equal(registrableDomain("site.pages.dev"), "site.pages.dev");
  assert.equal(registrableDomain("proj.vercel.app"), "proj.vercel.app");
  assert.equal(registrableDomain("blog.netlify.app"), "blog.netlify.app");
  assert.equal(registrableDomain("app.azurewebsites.net"), "app.azurewebsites.net");
  assert.equal(registrableDomain("d111.cloudfront.net"), "d111.cloudfront.net");
  assert.equal(registrableDomain("bucket.s3.amazonaws.com"), "bucket.s3.amazonaws.com");
});

test("deny of github.io blocks foo.github.io via suffix match", () => {
  const denied = applyDecision({ stored: {}, once: new Set() }, "github.io", "deny");
  const v = evaluatePolicy({
    url: "https://foo.github.io/x",
    stored: denied.stored,
    once: denied.once,
  });
  assert.equal(v.action, "deny");
  assert.equal(v.reason, "deny_site");
  assert.equal(v.domain, "foo.github.io");
});

test("about:blank is allowlisted; chrome://extensions is not", () => {
  const blank = evaluatePolicy({
    url: "about:blank",
    stored: {},
    once: new Set(),
  });
  assert.equal(blank.action, "proceed");
  assert.equal(blank.reason, "internal");

  const ext = evaluatePolicy({
    url: "chrome://extensions",
    stored: {},
    once: new Set(),
  });
  assert.equal(ext.action, "deny");
  assert.equal(ext.reason, "internal_not_allowlisted");

  const devtools = evaluatePolicy({
    url: "devtools://devtools/bundled/inspector.html",
    stored: {},
    once: new Set(),
  });
  assert.equal(devtools.action, "deny");
});

test("own chrome-extension origin proceeds; other extension ids do not", () => {
  const own = evaluatePolicy({
    url: "chrome-extension://pikkhapdmpoooagfjiogpjaleapphnmh/popup.html",
    stored: {},
    once: new Set(),
  });
  assert.equal(own.action, "proceed");
  const other = evaluatePolicy({
    url: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html",
    stored: {},
    once: new Set(),
  });
  assert.equal(other.action, "deny");
});

test("unknown https site is allowed by default", () => {
  const v = evaluatePolicy({
    url: "https://news.example.com/path",
    stored: {},
    once: new Set(),
  });
  assert.equal(v.action, "proceed");
  assert.equal(v.reason, "default_allow");
  assert.equal(v.domain, "example.com");
});

test("allow site persists and proceeds", () => {
  const next = applyDecision({ stored: {}, once: new Set() }, "example.com", "allow");
  const v = evaluatePolicy({
    url: "https://www.example.com",
    stored: next.stored,
    once: next.once,
  });
  assert.equal(v.action, "proceed");
  assert.equal(v.reason, "allow_site");
});

test("deny site blocks", () => {
  const next = applyDecision({ stored: {}, once: new Set() }, "ads.example", "deny");
  const denied = applyDecision({ stored: {}, once: new Set() }, "blocked.test", "deny");
  const v = evaluatePolicy({
    url: "https://blocked.test/x",
    stored: denied.stored,
    once: denied.once,
  });
  assert.equal(v.action, "deny");
  assert.equal(v.reason, "deny_site");
  void next;
});

test("allow once is session-only", () => {
  const next = applyDecision({ stored: {}, once: new Set() }, "once.test", "allow-once");
  assert.equal(next.stored["once.test"], undefined);
  const v = evaluatePolicy({
    url: "https://once.test/",
    stored: next.stored,
    once: next.once,
  });
  assert.equal(v.action, "proceed");
  assert.equal(v.reason, "allow_once");
  const later = evaluatePolicy({
    url: "https://once.test/",
    stored: {},
    once: new Set(),
  });
  assert.equal(later.action, "proceed");
});

test("unsupported protocols are denied", () => {
  const v = evaluatePolicy({ url: "ftp://files.example.com", stored: {}, once: new Set() });
  assert.equal(v.action, "deny");
  const file = evaluatePolicy({ url: "file:///etc/passwd", stored: {}, once: new Set() });
  assert.equal(file.action, "deny");
  const js = evaluatePolicy({ url: "javascript:alert(1)", stored: {}, once: new Set() });
  assert.equal(js.action, "deny");
  const data = evaluatePolicy({ url: "data:text/html,hi", stored: {}, once: new Set() });
  assert.equal(data.action, "deny");
  const bad = evaluatePolicy({ url: "not a url", stored: {}, once: new Set() });
  assert.equal(bad.action, "deny");
});

test("loopback RFC1918 link-local and metadata hosts are denied", () => {
  const cases = [
    "http://127.0.0.1/",
    "http://localhost:3000/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.4.4/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fd00:ec2::254]/",
    "http://metadata.google.internal/",
  ];
  for (const url of cases) {
    const v = evaluatePolicy({ url, stored: {}, once: new Set() });
    assert.equal(v.action, "deny", url);
    assert.equal(v.reason, "private_or_internal_host", url);
  }
  assert.equal(isPrivateOrSpecialHost("169.254.169.254"), true);
  assert.equal(isPrivateOrSpecialHost("8.8.8.8"), false);
});

test("public https remains default-allow", () => {
  const v = evaluatePolicy({
    url: "https://example.com/",
    stored: {},
    once: new Set(),
  });
  assert.equal(v.action, "proceed");
  assert.equal(v.reason, "default_allow");
});

test("domainForUrl reports public eTLD+1 and rejects other extensions", () => {
  assert.equal(domainForUrl("chrome-extension://abc/popup.html").ok, false);
  assert.equal(domainForUrl("chrome-extension://pikkhapdmpoooagfjiogpjaleapphnmh/popup.html").ok, true);
  assert.equal(domainForUrl("https://docs.foo.co.uk/a").domain, "foo.co.uk");
});

test("tabs_list omits denied domains so title and URL do not leak", () => {
  const denied = applyDecision({ stored: {}, once: new Set() }, "secret.test", "deny");
  const tabs = [
    { id: 1, title: "Public", url: "https://example.com" },
    { id: 2, title: "Secret inbox", url: "https://secret.test/mail" },
    { id: 3, title: "Extensions", url: "chrome://extensions" },
    { id: 4, title: "Router", url: "http://192.168.0.1/" },
    { id: 5, title: "", url: "" },
  ];
  const listed = filterListedTabs(tabs, denied.stored, denied.once);
  assert.deepEqual(
    listed.map((t: { id: number }) => t.id),
    [1, 5],
  );
  const blob = JSON.stringify(listed);
  assert.doesNotMatch(blob, /Secret inbox/);
  assert.doesNotMatch(blob, /secret\.test/);
  assert.doesNotMatch(blob, /chrome:\/\/extensions/);
  assert.doesNotMatch(blob, /192\.168\.0\.1/);
});
