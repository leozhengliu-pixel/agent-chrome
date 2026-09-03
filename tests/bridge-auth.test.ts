import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { startBridge } from "../bridge/server.js";
import { listenOrAttach } from "../bridge/listen.js";
import { MAX_NATIVE_MESSAGE_BYTES } from "../shared/constants.js";
import { writeBridgeProof } from "../shared/config.js";
import { isAllowedWsOrigin, tokenEquals } from "../shared/auth.js";
import { PassThrough } from "node:stream";
import { runHost } from "../host/run.js";

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test("tokenEquals is length-safe and matches equal tokens", () => {
  assert.equal(tokenEquals("abc", "abc"), true);
  assert.equal(tokenEquals("abc", "abd"), false);
  assert.equal(tokenEquals("short", "longer-token"), false);
  assert.equal(tokenEquals("", "x"), false);
});

test("isAllowedWsOrigin rejects random web origins", () => {
  assert.equal(isAllowedWsOrigin(undefined), true);
  assert.equal(isAllowedWsOrigin(""), true);
  assert.equal(isAllowedWsOrigin("null"), true);
  assert.equal(isAllowedWsOrigin("http://localhost"), true);
  assert.equal(isAllowedWsOrigin("http://127.0.0.1:9"), true);
  assert.equal(isAllowedWsOrigin("https://evil.example"), false);
  assert.equal(isAllowedWsOrigin("https://example.com"), false);
});

test("HTTP auth is Bearer-only; query tokens are rejected; health is gated", async () => {
  const token = "unit-bearer-token-aaaaaaaa";
  const bridge = await startBridge({ host: "127.0.0.1", port: 0, token });
  try {
    const base = `http://127.0.0.1:${bridge.port}`;
    const noAuth = await fetch(`${base}/health`);
    assert.equal(noAuth.status, 401);
    const query = await fetch(`${base}/health?token=${token}`);
    assert.equal(query.status, 401);
    const ok = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { ok?: boolean };
    assert.equal(body.ok, true);
  } finally {
    await bridge.close();
  }
});

test("/host upgrade rejects a random Origin even with a valid Bearer token", async () => {
  const token = "origin-token-bbbbbbbb";
  const bridge = await startBridge({ host: "127.0.0.1", port: 0, token });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/host`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example" },
    });
    const closed = await new Promise<number | undefined>((resolve) => {
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode);
        res.resume();
        ws.terminate();
      });
      ws.on("open", () => resolve(101));
      ws.on("error", () => resolve(undefined));
    });
    assert.notEqual(closed, 101);
    await wait(50);
    assert.equal(bridge.session.connected, false);
  } finally {
    await bridge.close();
  }
});

test("POST /rpc rejects bodies larger than 1 MiB", async () => {
  const token = "body-cap-token-cccccccc";
  const bridge = await startBridge({ host: "127.0.0.1", port: 0, token });
  try {
    const big = "x".repeat(MAX_NATIVE_MESSAGE_BYTES + 64);
    const res = await fetch(`http://127.0.0.1:${bridge.port}/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: `{"method":"status","pad":"${big}"}`,
    });
    assert.equal(res.status, 413);
  } finally {
    await bridge.close();
  }
});

test("fake occupant of the port does not receive the token and attach is refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-proof-"));
  const seen: string[] = [];
  const stranger = http.createServer((req, res) => {
    seen.push(String(req.headers.authorization || ""));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result: { pwned: true } }));
  });
  await new Promise<void>((resolve) => stranger.listen(0, "127.0.0.1", () => resolve()));
  const addr = stranger.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const secret = "should-never-be-sent-to-stranger";
  try {
    await assert.rejects(
      () =>
        listenOrAttach({
          host: "127.0.0.1",
          port,
          token: secret,
          mcpCommand: "test",
          configDir: dir,
        }),
      (err: unknown) => {
        assert.match((err as Error).message, /not a proven Agent Chrome bridge/i);
        assert.match((err as Error).message, /Refusing to send the auth token/i);
        return true;
      },
    );
    await wait(50);
    assert.equal(seen.length, 0);
    assert.ok(seen.every((h) => !h.includes(secret)));
  } finally {
    await new Promise<void>((resolve) => stranger.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("host with requireProof does not open a websocket to an unproven occupant", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-host-proof-"));
  const seen: string[] = [];
  const stranger = http.createServer((_req, res) => {
    res.writeHead(400);
    res.end();
  });
  stranger.on("upgrade", (req, socket) => {
    seen.push(String(req.headers.authorization || ""));
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });
  await new Promise<void>((resolve) => stranger.listen(0, "127.0.0.1", () => resolve()));
  const addr = stranger.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const secret = "host-must-not-send-this";
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const done = runHost({
    stdin,
    stdout,
    stderr,
    url: `ws://127.0.0.1:${port}/host`,
    token: secret,
    requireProof: true,
    configDir: dir,
  });
  await wait(200);
  stdin.end();
  await Promise.race([done, wait(300)]);
  try {
    assert.equal(seen.length, 0);
  } finally {
    await new Promise<void>((resolve) => stranger.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("listenOrAttach attaches to a proven occupant and can RPC", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chrome-attach-"));
  const token = "proven-attach-token-dddddddd";
  const first = await listenOrAttach({
    host: "127.0.0.1",
    port: 0,
    token,
    mcpCommand: "test",
    configDir: dir,
  });
  try {
    assert.ok(first.bridge);
    writeBridgeProof(dir);
    const second = await listenOrAttach({
      host: "127.0.0.1",
      port: first.bridge!.port,
      token,
      mcpCommand: "test",
      configDir: dir,
    });
    assert.equal(second.bridge, undefined);
    const status = (await second.rpc("status")) as { version?: string };
    assert.ok(status.version);
    await second.close();
  } finally {
    await first.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
