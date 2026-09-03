import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { WebSocket } from "ws";
import { startBridge } from "../bridge/server.js";
import { Session } from "../bridge/session.js";
import { handleMcp, startMcpStdio } from "../bridge/mcp.js";
import { runHost } from "../host/run.js";
import { encodeLengthPrefixed, LengthPrefixedDecoder } from "../shared/framing.js";
import { ExtensionDisconnectedError } from "../shared/protocol.js";

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await wait(25);
  }
}

test("interactive tools fail fast when extension is disconnected", async () => {
  const token = "loopback-token-disconnected";
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    token,
    connectTimeoutMs: 50,
    launchChrome: () => ({ attempted: false, skipReason: "test skip" }),
  });
  try {
    await assert.rejects(() => bridge.rpc("tabs_list"), ExtensionDisconnectedError);
    const mcp = (await handleMcp(bridge.rpc, {
      method: "tools/call",
      params: { name: "snapshot", arguments: { tabId: 1 } },
    })) as { isError?: boolean; content: Array<{ text?: string }> };
    assert.equal(mcp.isError, true);
    assert.match(mcp.content[0]?.text || "", /disconnected/i);
    const status = (await bridge.rpc("status")) as {
      extensionConnected: boolean;
      chromeLaunchAttempted: boolean;
      chromeLaunch: string;
    };
    assert.equal(status.extensionConnected, false);
    assert.equal(status.chromeLaunchAttempted, false);
    assert.match(status.chromeLaunch, /test skip/);
  } finally {
    await bridge.close();
  }
});

test("status does not launch Chrome", async () => {
  let launches = 0;
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    token: "status-no-launch",
    launchChrome: () => {
      launches += 1;
      return { attempted: true, command: "should-not-run" };
    },
  });
  try {
    const status = (await bridge.rpc("status")) as {
      extensionConnected: boolean;
      chromeLaunchAttempted: boolean;
      chromeLaunch: string;
    };
    assert.equal(status.extensionConnected, false);
    assert.equal(status.chromeLaunchAttempted, false);
    assert.ok(status.chromeLaunch);
    assert.equal(launches, 0);
  } finally {
    await bridge.close();
  }
});

test("rpc on interactive tool when disconnected attempts launch", async () => {
  let launches = 0;
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    token: "launch-attempt",
    connectTimeoutMs: 40,
    launchChrome: () => {
      launches += 1;
      return { attempted: true, command: "fake-chrome --profile-directory=Default" };
    },
  });
  try {
    await assert.rejects(
      () => bridge.rpc("tabs_list"),
      (err: unknown) => {
        assert.ok(err instanceof ExtensionDisconnectedError);
        assert.match((err as Error).message, /launched but the extension did not connect/i);
        assert.match((err as Error).message, /pikkhapdmpoooagfjiogpjaleapphnmh/);
        return true;
      },
    );
    assert.equal(launches, 1);
    const status = (await bridge.rpc("status")) as {
      chromeLaunchAttempted: boolean;
      chromeLaunch: string;
    };
    assert.equal(status.chromeLaunchAttempted, true);
    assert.equal(status.chromeLaunch, "fake-chrome --profile-directory=Default");
    assert.equal(launches, 1);
  } finally {
    await bridge.close();
  }
});

test("rpc proceeds after launch once the native host reconnects", async () => {
  const token = "launch-reconnect";
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    token,
    connectTimeoutMs: 2000,
    launchChrome: () => {
      setTimeout(() => {
        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/host`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString()) as { id?: string; method?: string };
          if (msg.id && msg.method === "tabs_list") {
            ws.send(JSON.stringify({ id: msg.id, result: { tabs: [{ tabId: 3 }] } }));
          }
        });
      }, 30);
      return { attempted: true, command: "fake-chrome" };
    },
  });
  try {
    const result = (await bridge.rpc("tabs_list")) as { tabs: Array<{ tabId: number }> };
    assert.equal(result.tabs[0]?.tabId, 3);
  } finally {
    await bridge.close();
  }
});

test("waitUntilConnected resolves on attach and times out with afterLaunchTimeout", async () => {
  const session = new Session();
  const fake = {
    readyState: 1,
    on() {},
    send() {},
    close() {},
  };
  const pending = session.waitUntilConnected(1000);
  session.attach(fake as unknown as WebSocket);
  await pending;
  assert.equal(session.connected, true);
  session.close();

  const disconnected = new Session();
  await assert.rejects(
    () => disconnected.waitUntilConnected(20),
    (err: unknown) => {
      assert.ok(err instanceof ExtensionDisconnectedError);
      assert.match((err as Error).message, /pikkhapdmpoooagfjiogpjaleapphnmh/);
      return true;
    },
  );
});

test("native-messaging loopback: fake Chrome through host to bridge and MCP", async () => {
  const token = "loopback-token-connected";
  let launches = 0;
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    token,
    mcpCommand: "node dist/bridge/index.js --mcp",
    launchChrome: () => {
      launches += 1;
      return { attempted: true, command: "should-not-run-when-connected" };
    },
  });

  const toHost = new PassThrough();
  const fromHost = new PassThrough();
  const hostErr = new PassThrough();

  const hostDone = runHost({
    stdin: toHost,
    stdout: fromHost,
    stderr: hostErr,
    url: `ws://127.0.0.1:${bridge.port}/host`,
    token,
  });

  const decoder = new LengthPrefixedDecoder();
  const chromeState = {
    tabs: [
      { tabId: 7, title: "Example", url: "https://example.com", active: false, windowId: 1 },
    ],
  };

  fromHost.on("data", (chunk: Buffer) => {
    const messages = decoder.push(chunk);
    for (const msg of messages) {
      const m = msg as { id?: string; method?: string; type?: string };
      if (m.type === "hello" || m.type === "bridge-status") return;
      if (m.id && m.method) {
        let result: unknown = { ok: true, method: m.method };
        if (m.method === "status") {
          result = { version: "1.0.0", extensionId: "test", debuggerAttached: [] };
        } else if (m.method === "tabs_list") {
          result = { tabs: chromeState.tabs };
        } else if (m.method === "snapshot") {
          result = {
            tabId: 7,
            url: "https://example.com",
            title: "Example",
            refCount: 2,
            tree: '- document [e1]\n  - button "Go" [e2]',
          };
        } else if (m.method === "click") {
          result = { tabId: 7, ref: "e2", x: 10, y: 20 };
        }
        toHost.write(encodeLengthPrefixed({ id: m.id, result }));
      }
    }
  });

  try {
    await waitFor(() => bridge.session.connected);

    const tabs = (await bridge.rpc("tabs_list")) as { tabs: Array<{ tabId: number }> };
    assert.equal(tabs.tabs[0]?.tabId, 7);
    assert.equal(launches, 0);

    const snap = (await handleMcp(bridge.rpc, {
      method: "tools/call",
      params: { name: "snapshot", arguments: { tabId: 7 } },
    })) as { isError?: boolean; content: Array<{ text?: string }> };
    assert.equal(snap.isError, undefined);
    assert.match(snap.content[0]?.text || "", /button/);

    const click = (await bridge.rpc("click", { tabId: 7, ref: "e2" })) as { ref: string };
    assert.equal(click.ref, "e2");

    const mcpIn = new PassThrough();
    const mcpOut = new PassThrough();
    const mcpLines: string[] = [];
    mcpOut.on("data", (c: Buffer) => {
      mcpLines.push(...c.toString("utf8").split("\n").filter(Boolean));
    });
    const mcpDone = startMcpStdio(bridge.rpc, mcpIn, mcpOut);
    mcpIn.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tabs_list", arguments: {} } })}\n`,
    );
    await waitFor(() => mcpLines.length >= 1);
    const reply = JSON.parse(mcpLines[0] || "{}") as { result?: { content?: Array<{ text?: string }> } };
    assert.match(reply.result?.content?.[0]?.text || "", /"tabId": 7/);
    mcpIn.end();
    await mcpDone;
  } finally {
    toHost.end();
    fromHost.end();
    await Promise.race([hostDone, wait(200)]);
    await bridge.close();
  }
});
