import fs from "node:fs";
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Session } from "./session.js";
import { VERSION, BRIDGE_PORT, MAX_NATIVE_MESSAGE_BYTES } from "../shared/constants.js";
import { ExtensionDisconnectedError } from "../shared/protocol.js";
import { INTERACTIVE_TOOLS, TOOLS } from "../shared/tools.js";
import {
  CHROME_CONNECT_TIMEOUT_MS,
  ChromeLaunchError,
  describeChromeLaunch,
  launchChrome,
  type LaunchChromeResult,
} from "../shared/launch-chrome.js";
import { bearerToken, isAllowedWsOrigin, tokenEquals } from "../shared/auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";

export type ChromeLauncher = () => LaunchChromeResult | Promise<LaunchChromeResult>;

export type BridgeOptions = {
  host?: string;
  port?: number;
  token: string;
  mcpCommand?: string;
  launchChrome?: ChromeLauncher;
  connectTimeoutMs?: number;
  socketPath?: string;
};

export type Bridge = {
  host: string;
  port: number;
  token: string;
  session: Session;
  mcpCommand: string;
  socketPath?: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

function readBody(req: IncomingMessage, maxBytes = MAX_NATIVE_MESSAGE_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        const err = new Error(`request body too large: ${size} bytes`);
        (err as NodeJS.ErrnoException).code = "PAYLOAD_TOO_LARGE";
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": data.length,
  });
  res.end(data);
}

function tokenOf(req: IncomingMessage): string {
  return bearerToken(req.headers.authorization);
}

function authorized(req: IncomingMessage, expected: string): boolean {
  return tokenEquals(tokenOf(req), expected);
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const host = options.host || "127.0.0.1";
  const mcpCommand = options.mcpCommand || "";
  const session = new Session(mcpCommand);
  const launcher: ChromeLauncher = options.launchChrome || (() => launchChrome());
  const connectTimeoutMs = options.connectTimeoutMs ?? CHROME_CONNECT_TIMEOUT_MS;
  let lastLaunch: LaunchChromeResult | null = null;
  let ensuring: Promise<void> | null = null;

  const httpHandler = async (req: IncomingMessage, res: ServerResponse) => {
    if (!authorized(req, options.token)) {
      json(res, 401, { error: { code: "UNAUTHORIZED", message: "invalid token" } });
      return;
    }
    const url = new URL(req.url || "/", `http://${host}`);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, version: VERSION });
        return;
      }
      if (req.method === "GET" && url.pathname === "/status") {
        json(res, 200, await rpc("status"));
        return;
      }
      if (req.method === "POST" && url.pathname === "/rpc") {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          method?: string;
          params?: Record<string, unknown>;
        };
        if (!body.method) {
          json(res, 400, { error: { code: "INVALID_ARGS", message: "method is required" } });
          return;
        }
        const result = await rpc(body.method, body.params || {});
        json(res, 200, { result });
        return;
      }
      json(res, 404, { error: { code: "NOT_FOUND", message: "unknown route" } });
    } catch (err) {
      const e = err as Error & { code?: string };
      const status =
        e.code === "PAYLOAD_TOO_LARGE"
          ? 413
          : e instanceof ExtensionDisconnectedError || e instanceof ChromeLaunchError
            ? 503
            : 400;
      json(res, status, { error: { code: e.code || "ERROR", message: e.message } });
    }
  };

  const upgradeHandler = (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = new URL(req.url || "/", `http://${host}`);
    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (url.pathname !== "/host" || !authorized(req, options.token) || !isAllowedWsOrigin(origin)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      session.attach(ws);
    });
  };

  const server = http.createServer(httpHandler);
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", upgradeHandler);

  async function doEnsureConnected(): Promise<void> {
    if (session.connected) return;
    try {
      lastLaunch = await Promise.resolve(launcher());
    } catch (err) {
      lastLaunch = { attempted: false, skipReason: (err as Error).message };
      throw err;
    }
    if (session.connected) return;
    if (!lastLaunch.attempted) {
      const skip = lastLaunch.skipReason ? ` Chrome auto-launch skipped: ${lastLaunch.skipReason}.` : "";
      throw new ExtensionDisconnectedError(
        `Agent Chrome extension is disconnected.${skip} Load the unpacked extension, keep Chrome open, and confirm the popup shows Connected.`,
      );
    }
    try {
      await session.waitUntilConnected(connectTimeoutMs);
    } catch (err) {
      if (err instanceof ExtensionDisconnectedError) throw err;
      throw ExtensionDisconnectedError.afterLaunchTimeout();
    }
  }

  async function ensureConnected(): Promise<void> {
    if (session.connected) return;
    if (!ensuring) {
      ensuring = doEnsureConnected().finally(() => {
        ensuring = null;
      });
    }
    await ensuring;
  }

  async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === "status") {
      let extension: unknown = null;
      let extensionError: string | null = null;
      if (session.connected) {
        try {
          extension = await session.request("status", {}, 4000);
        } catch (err) {
          extensionError = (err as Error).message;
        }
      }
      return {
        version: VERSION,
        bridge: { host, port: addressPort(), listening: true },
        host: { connected: session.connected },
        extension: extension || { connected: false },
        extensionConnected: session.connected,
        chromeLaunchAttempted: Boolean(lastLaunch?.attempted),
        chromeLaunch: lastLaunch?.command || lastLaunch?.skipReason || describeChromeLaunch(),
        mcpCommand,
        lastError: extensionError,
        tools: TOOLS.map((t) => t.name),
      };
    }
    if (INTERACTIVE_TOOLS.has(method) && !session.connected) {
      await ensureConnected();
    }
    return session.request(method, params);
  }

  function addressPort(): number {
    const addr = server.address();
    if (addr && typeof addr === "object") return addr.port;
    return options.port ?? BRIDGE_PORT;
  }

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port ?? BRIDGE_PORT, host, () => resolve());
    server.on("error", reject);
  });

  let sockServer: http.Server | null = null;
  let usedSocketPath: string | undefined;
  if (options.socketPath && process.platform !== "win32") {
    try {
      fs.rmSync(options.socketPath, { force: true });
      sockServer = http.createServer(httpHandler);
      sockServer.on("upgrade", upgradeHandler);
      const pathToListen = options.socketPath;
      await new Promise<void>((resolve, reject) => {
        sockServer!.once("error", reject);
        sockServer!.listen(pathToListen, () => resolve());
      });
      fs.chmodSync(options.socketPath, 0o600);
      usedSocketPath = options.socketPath;
    } catch {
      try {
        sockServer?.close();
      } catch {
        // ignore
      }
      sockServer = null;
      usedSocketPath = undefined;
      try {
        fs.rmSync(options.socketPath, { force: true });
      } catch {
        // ignore
      }
    }
  }

  return {
    host,
    port: addressPort(),
    token: options.token,
    session,
    mcpCommand,
    socketPath: usedSocketPath,
    rpc,
    close: async () => {
      session.close();
      if (usedSocketPath) {
        try {
          fs.rmSync(usedSocketPath, { force: true });
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      if (sockServer) {
        await new Promise<void>((resolve) => sockServer!.close(() => resolve()));
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
