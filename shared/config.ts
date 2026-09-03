import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { BRIDGE_PORT } from "./constants.js";
import { chmodPrivateDir, chmodPrivateFile } from "./fs-safety.js";

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

export function proofPath(dir = configDir()): string {
  return path.join(dir, "bridge.proof");
}

export function socketPath(dir = configDir()): string {
  return path.join(dir, "bridge.sock");
}

function ensurePrivateConfigDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodPrivateDir(dir);
  } catch (err) {
    throw new Error(
      `Refusing to use config dir ${dir}: ${(err as Error).message}`,
    );
  }
}

export function loadOrCreateToken(dir = configDir()): string {
  ensurePrivateConfigDir(dir);
  const file = tokenPath(dir);
  if (fs.existsSync(file)) {
    try {
      chmodPrivateFile(file);
    } catch (err) {
      throw new Error(
        `Refusing to use token file ${file}: ${(err as Error).message}`,
      );
    }
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, token, { mode: 0o600 });
  try {
    chmodPrivateFile(file);
  } catch (err) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
    throw new Error(
      `Refusing to use token file ${file}: ${(err as Error).message}`,
    );
  }
  return token;
}

export function writePortFile(port: number, dir = configDir()): void {
  ensurePrivateConfigDir(dir);
  const file = portPath(dir);
  fs.writeFileSync(file, String(port), { mode: 0o600 });
  chmodPrivateFile(file);
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

export function isLoopbackBindHost(host: string): boolean {
  const h = String(host || "").trim().toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

export function resolveBridgeHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.AGENT_CHROME_BRIDGE_HOST || "127.0.0.1";
  if (!isLoopbackBindHost(host) && env.AGENT_CHROME_ALLOW_NON_LOOPBACK !== "1") {
    throw new Error(
      `Refusing to bind non-loopback host ${host}. Agent Chrome must listen on 127.0.0.1 or ::1. Set AGENT_CHROME_ALLOW_NON_LOOPBACK=1 only if you understand the risk (see SECURITY.md).`,
    );
  }
  return host;
}

export function bridgeHost(): string {
  return resolveBridgeHost();
}

export type BridgeProof = {
  pid: number;
  startedAt: number;
  secret: string;
};

export type ProofCheck =
  | { ok: true; proof: BridgeProof }
  | { ok: false; reason: string };

function readPidUid(pid: number): number | null {
  if (process.platform === "linux") {
    try {
      const txt = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const m = /^Uid:\s+(\d+)/m.exec(txt);
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function pidAliveAndSameUser(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ESRCH" || e.code === "EPERM") return false;
    return false;
  }
  if (process.platform === "win32") return true;
  const uid = process.getuid?.();
  if (uid == null) return true;
  const other = readPidUid(pid);
  if (other == null) return true;
  return other === uid;
}

export function writeBridgeProof(dir = configDir()): BridgeProof {
  ensurePrivateConfigDir(dir);
  const proof: BridgeProof = {
    pid: process.pid,
    startedAt: Date.now(),
    secret: crypto.randomBytes(16).toString("hex"),
  };
  const file = proofPath(dir);
  fs.writeFileSync(file, `${JSON.stringify(proof)}\n`, { mode: 0o600 });
  chmodPrivateFile(file);
  return proof;
}

export function removeBridgeProof(dir = configDir()): void {
  try {
    fs.unlinkSync(proofPath(dir));
  } catch {
    // ignore
  }
}

export function removeBridgeSocket(dir = configDir()): void {
  try {
    fs.unlinkSync(socketPath(dir));
  } catch {
    // ignore
  }
}

export function verifyBridgeProof(dir = configDir()): ProofCheck {
  const file = proofPath(dir);
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      reason: "bridge proof file missing (port may be taken by a stranger)",
    };
  }
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch (err) {
    return { ok: false, reason: `cannot stat proof file: ${(err as Error).message}` };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, reason: "bridge proof file is a symlink" };
  }
  if (!st.isFile()) {
    return { ok: false, reason: "bridge proof path is not a regular file" };
  }
  if (process.platform !== "win32") {
    const uid = process.getuid?.();
    if (uid != null && st.uid !== uid) {
      return { ok: false, reason: "bridge proof file is not owned by the current user" };
    }
    if (st.mode & 0o004) {
      return { ok: false, reason: "bridge proof file is other-readable" };
    }
    if ((st.mode & 0o077) !== 0) {
      return { ok: false, reason: "bridge proof file mode is not 0600" };
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: "bridge proof file is invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "bridge proof file is invalid" };
  }
  const proof = parsed as BridgeProof;
  const pid = Number(proof.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, reason: "bridge proof file has no valid pid" };
  }
  if (!pidAliveAndSameUser(pid)) {
    return {
      ok: false,
      reason: `bridge proof pid ${pid} is not an alive process owned by this user`,
    };
  }
  return { ok: true, proof: { pid, startedAt: Number(proof.startedAt) || 0, secret: String(proof.secret || "") } };
}

export function unprovenOccupantError(host: string, port: number, reason: string): Error {
  const err = new Error(
    `Port ${port} on ${host} is in use, but it is not a proven Agent Chrome bridge (${reason}). Refusing to send the auth token. Stop the other process or choose a different AGENT_CHROME_BRIDGE_PORT.`,
  );
  (err as NodeJS.ErrnoException).code = "BRIDGE_OCCUPANT_UNPROVEN";
  return err;
}
