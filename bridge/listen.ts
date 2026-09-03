import fs from "node:fs";
import http from "node:http";
import { startBridge, type Bridge, type ChromeLauncher } from "./server.js";
import {
  configDir,
  proofPath,
  removeBridgeProof,
  socketPath,
  unprovenOccupantError,
  verifyBridgeProof,
  writeBridgeProof,
  writePortFile,
} from "../shared/config.js";

export type ListenOrAttachOptions = {
  host: string;
  port: number;
  token: string;
  mcpCommand: string;
  configDir?: string;
  launchChrome?: ChromeLauncher;
  connectTimeoutMs?: number;
};

export type AttachedBridge = {
  bridge?: Bridge;
  rpc: Bridge["rpc"];
  close: () => Promise<void>;
};

function rpcViaUnix(
  sock: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const body = JSON.stringify({ method, params });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: sock,
        path: "/rpc",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              result?: unknown;
              error?: { message: string; code?: string };
            };
            if (res.statusCode && res.statusCode >= 400) {
              const err = new Error(parsed.error?.message || `HTTP ${res.statusCode}`);
              (err as Error & { code?: string }).code = parsed.error?.code;
              reject(err);
              return;
            }
            resolve(parsed.result);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function rpcViaHttp(
  host: string,
  port: number,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  sock?: string,
): Promise<unknown> {
  if (sock && process.platform !== "win32" && fs.existsSync(sock)) {
    return rpcViaUnix(sock, token, method, params);
  }
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

/**
 * Listen on the bridge port, or attach to an existing *proven* occupant.
 * Never send the auth token solely because the port is in use.
 */
export async function listenOrAttach(opts: ListenOrAttachOptions): Promise<AttachedBridge> {
  const dir = opts.configDir || configDir();
  const sock = process.platform === "win32" ? undefined : socketPath(dir);
  try {
    const bridge = await startBridge({
      host: opts.host,
      port: opts.port,
      token: opts.token,
      mcpCommand: opts.mcpCommand,
      launchChrome: opts.launchChrome,
      connectTimeoutMs: opts.connectTimeoutMs,
      socketPath: sock,
    });
    writePortFile(bridge.port, dir);
    writeBridgeProof(dir);
    return {
      bridge,
      rpc: (method, params) => bridge.rpc(method, params),
      close: async () => {
        removeBridgeProof(dir);
        await bridge.close();
      },
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "EADDRINUSE") throw err;
    const check = verifyBridgeProof(dir);
    if (!check.ok) {
      throw unprovenOccupantError(opts.host, opts.port, check.reason);
    }
    const existingSock =
      sock && fs.existsSync(sock) && fs.existsSync(proofPath(dir)) ? sock : undefined;
    return {
      rpc: (method, params) =>
        rpcViaHttp(opts.host, opts.port, opts.token, method, params || {}, existingSock),
      close: async () => undefined,
    };
  }
}
