import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  loadOrCreateToken,
  proofPath,
  resolveBridgeHost,
  tokenPath,
  verifyBridgeProof,
  writeBridgeProof,
} from "../shared/config.js";
import { assertOwnedAndNotWorldWritable } from "../shared/fs-safety.js";

test("resolveBridgeHost defaults to 127.0.0.1 and refuses non-loopback", () => {
  assert.equal(resolveBridgeHost({}), "127.0.0.1");
  assert.equal(resolveBridgeHost({ AGENT_CHROME_BRIDGE_HOST: "127.0.0.1" }), "127.0.0.1");
  assert.equal(resolveBridgeHost({ AGENT_CHROME_BRIDGE_HOST: "::1" }), "::1");
  assert.throws(
    () => resolveBridgeHost({ AGENT_CHROME_BRIDGE_HOST: "0.0.0.0" }),
    /non-loopback/,
  );
  assert.throws(
    () => resolveBridgeHost({ AGENT_CHROME_BRIDGE_HOST: "192.168.1.5" }),
    /AGENT_CHROME_ALLOW_NON_LOOPBACK/,
  );
  assert.equal(
    resolveBridgeHost({
      AGENT_CHROME_BRIDGE_HOST: "0.0.0.0",
      AGENT_CHROME_ALLOW_NON_LOOPBACK: "1",
    }),
    "0.0.0.0",
  );
});

test("loadOrCreateToken chmods dir 0700 and file 0600", () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-token-"));
  fs.chmodSync(dir, 0o777);
  try {
    const token = loadOrCreateToken(dir);
    assert.ok(token.length >= 32);
    const dst = fs.statSync(dir);
    assert.equal(dst.mode & 0o077, 0);
    const fst = fs.statSync(tokenPath(dir));
    assert.equal(fst.mode & 0o077, 0);
    fs.chmodSync(tokenPath(dir), 0o644);
    loadOrCreateToken(dir);
    const repaired = fs.statSync(tokenPath(dir));
    assert.equal(repaired.mode & 0o077, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyBridgeProof fails closed without a live same-uid 0600 proof", () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-proofv-"));
  try {
    let check = verifyBridgeProof(dir);
    assert.equal(check.ok, false);
    writeBridgeProof(dir);
    check = verifyBridgeProof(dir);
    assert.equal(check.ok, true);
    fs.chmodSync(proofPath(dir), 0o644);
    check = verifyBridgeProof(dir);
    assert.equal(check.ok, false);
    assert.match(check.ok ? "" : check.reason, /other-readable|0600/);
    fs.writeFileSync(proofPath(dir), JSON.stringify({ pid: 1, startedAt: 0, secret: "x" }), {
      mode: 0o600,
    });
    fs.chmodSync(proofPath(dir), 0o600);
    check = verifyBridgeProof(dir);
    assert.equal(check.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assertOwnedAndNotWorldWritable rejects group/other-writable files", () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-fs-"));
  const file = path.join(dir, "wrapper");
  fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
  fs.chmodSync(file, 0o777);
  try {
    assert.throws(() => assertOwnedAndNotWorldWritable(file), /writable by group or others/);
    fs.chmodSync(file, 0o755);
    assert.doesNotThrow(() => assertOwnedAndNotWorldWritable(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
