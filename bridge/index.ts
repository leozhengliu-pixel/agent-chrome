#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMcpStdio } from "./mcp.js";
import { BRIDGE_PORT, VERSION } from "../shared/constants.js";
import { bridgeHost, bridgePort, loadOrCreateToken } from "../shared/config.js";
import { listenOrAttach } from "./listen.js";

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function mcpCommandFor(root: string): string {
  return `node ${path.join(root, "dist", "bridge", "index.js")} --mcp`;
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
