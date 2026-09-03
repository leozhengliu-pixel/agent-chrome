import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDecision,
  domainForUrl,
  evaluatePolicy,
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

test("internal chrome URLs proceed without prompt", () => {
  const v = evaluatePolicy({
    url: "chrome://extensions",
    stored: {},
    once: new Set(),
  });
  assert.equal(v.action, "proceed");
  assert.equal(v.reason, "internal");
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
  // domain is registrable of hostname, use a real url
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
  const bad = evaluatePolicy({ url: "not a url", stored: {}, once: new Set() });
  assert.equal(bad.action, "deny");
});

test("domainForUrl reports internal vs public", () => {
  assert.equal(domainForUrl("chrome-extension://abc/popup.html").internal, true);
  assert.equal(domainForUrl("https://docs.foo.co.uk/a").domain, "foo.co.uk");
});
