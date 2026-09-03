#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startBridge, type Bridge } from "./server.js";
import { startMcpStdio } from "./mcp.js";
import { BRIDGE_PORT, VERSION } from "../shared/constants.js";
import { bridgeHost, bridgePort, loadOrCreateToken, writePortFile } from "../shared/config.js";

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function mcpCommandFor(root: string): string {
  return `node ${path.join(root, "dist", "bridge", "index.js")} --mcp`;
}

async function rpcViaHttp(
  host: string,
  port: number,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`http://${host}:${port}/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string; code?: string } };
  if (!res.ok) {
    const err = new Error(body.error?.message || `HTTP ${res.status}`);
    (err as Error & { code?: string }).code = body.error?.code;
    throw err;
  }
  return body.result;
}

async function listenOrAttach(opts: {
  host: string;
  port: number;
  token: string;
  mcpCommand: string;
}): Promise<{ bridge?: Bridge; rpc: Bridge["rpc"]; close: () => Promise<void> }> {
  try {
    const bridge = await startBridge({
      host: opts.host,
      port: opts.port,
      token: opts.token,
      mcpCommand: opts.mcpCommand,
    });
    writePortFile(bridge.port);
    return {
      bridge,
      rpc: (method, params) => bridge.rpc(method, params),
      close: () => bridge.close(),
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "EADDRINUSE") throw err;
    return {
      rpc: (method, params) => rpcViaHttp(opts.host, opts.port, opts.token, method, params),
      close: async () => undefined,
    };
  }
}

const args = new Set(process.argv.slice(2));
const asMcp = args.has("--mcp") || args.has("mcp");
const token = process.env.AGENT_CHROME_TOKEN || loadOrCreateToken();
const host = bridgeHost();
const port = Number.isInteger(Number(process.env.AGENT_CHROME_BRIDGE_PORT))
  ? Number(process.env.AGENT_CHROME_BRIDGE_PORT)
  : bridgePort() || BRIDGE_PORT;
const mcpCommand = mcpCommandFor(repoRoot());

const started = await listenOrAttach({ host, port, token, mcpCommand });

if (!asMcp) {
  process.stderr.write(
    `Agent Chrome bridge v${VERSION} listening on http://${host}:${started.bridge?.port ?? port}\n`,
  );
  process.stderr.write(`MCP: ${mcpCommand}\n`);
}

if (asMcp) {
  await startMcpStdio(started.rpc);
  await started.close();
  process.exit(0);
}

const shutdown = async () => {
  await started.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
