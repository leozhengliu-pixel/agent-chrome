import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { BRIDGE_PORT } from "./constants.js";

export function configDir(override = process.env.AGENT_CHROME_CONFIG_DIR): string {
  if (override) return override;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "agent-chrome");
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "agent-chrome");
  }
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "agent-chrome");
}

export function tokenPath(dir = configDir()): string {
  return path.join(dir, "token");
}

export function portPath(dir = configDir()): string {
  return path.join(dir, "bridge-port");
}

export function loadOrCreateToken(dir = configDir()): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = tokenPath(dir);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function writePortFile(port: number, dir = configDir()): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(portPath(dir), String(port), { mode: 0o600 });
}

export function readPortFile(dir = configDir()): number | null {
  const file = portPath(dir);
  if (!fs.existsSync(file)) return null;
  const n = Number(fs.readFileSync(file, "utf8").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function bridgePort(): number {
  const env = process.env.AGENT_CHROME_BRIDGE_PORT;
  if (env) {
    const n = Number(env);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return BRIDGE_PORT;
}

export function bridgeHost(): string {
  return process.env.AGENT_CHROME_BRIDGE_HOST || "127.0.0.1";
}
