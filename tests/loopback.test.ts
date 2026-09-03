import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { startBridge } from "../bridge/server.js";
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
  const bridge = await startBridge({ host: "127.0.0.1", port: 0, token });
  try {
    await assert.rejects(() => bridge.rpc("tabs_list"), ExtensionDisconnectedError);
    const mcp = (await handleMcp(bridge.rpc, {
      method: "tools/call",
      params: { name: "snapshot", arguments: { tabId: 1 } },
    })) as { isError?: boolean; content: Array<{ text?: string }> };
    assert.equal(mcp.isError, true);
    assert.match(mcp.content[0]?.text || "", /disconnected/i);
    const status = (await bridge.rpc("status")) as { extensionConnected: boolean };
    assert.equal(status.extensionConnected, false);
  } finally {
    await bridge.close();
  }
});

test("native-messaging loopback: fake Chrome through host to bridge and MCP", async () => {
  const token = "loopback-token-connected";
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    token,
    mcpCommand: "node dist/bridge/index.js --mcp",
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
