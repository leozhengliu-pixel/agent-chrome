#!/usr/bin/env node
import { runHost } from "./run.js";
import {
  bridgeHost,
  bridgePort,
  configDir,
  loadOrCreateToken,
  readPortFile,
  socketPath,
} from "../shared/config.js";

const dir = configDir();
const token = process.env.AGENT_CHROME_TOKEN || loadOrCreateToken(dir);
const port = process.env.AGENT_CHROME_BRIDGE_PORT
  ? Number(process.env.AGENT_CHROME_BRIDGE_PORT)
  : readPortFile(dir) || bridgePort();
const host = bridgeHost();
const url = `ws://${host}:${port}/host`;
const sock = process.platform === "win32" ? undefined : socketPath(dir);

runHost({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  url,
  token,
  socketPath: sock,
  requireProof: true,
  configDir: dir,
}).catch((err) => {
  process.stderr.write(`agent-chrome-host: ${err?.message || err}\n`);
  process.exit(1);
});
