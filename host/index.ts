#!/usr/bin/env node
import { runHost } from "./run.js";
import { bridgeHost, bridgePort, configDir, loadOrCreateToken, readPortFile } from "../shared/config.js";

const token = process.env.AGENT_CHROME_TOKEN || loadOrCreateToken();
const port = process.env.AGENT_CHROME_BRIDGE_PORT
  ? Number(process.env.AGENT_CHROME_BRIDGE_PORT)
  : readPortFile(configDir()) || bridgePort();
const host = bridgeHost();
const url = `ws://${host}:${port}/host`;

runHost({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  url,
  token,
}).catch((err) => {
  process.stderr.write(`agent-chrome-host: ${err?.message || err}\n`);
  process.exit(1);
});
