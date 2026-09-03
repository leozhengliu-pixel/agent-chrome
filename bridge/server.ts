import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Session } from "./session.js";
import { VERSION, BRIDGE_PORT } from "../shared/constants.js";
import { ExtensionDisconnectedError } from "../shared/protocol.js";
import { INTERACTIVE_TOOLS, TOOLS } from "../shared/tools.js";
import type { IncomingMessage, ServerResponse } from "node:http";

export type BridgeOptions = {
  host?: string;
  port?: number;
  token: string;
  mcpCommand?: string;
};

export type Bridge = {
  host: string;
  port: number;
  token: string;
  session: Session;
  mcpCommand: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
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

function tokenOf(req: IncomingMessage, url: URL): string {
  const header = req.headers.authorization;
  if (header && header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return url.searchParams.get("token") || "";
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const host = options.host || "127.0.0.1";
  const mcpCommand = options.mcpCommand || "";
  const session = new Session(mcpCommand);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);
    if (tokenOf(req, url) !== options.token) {
      json(res, 401, { error: { code: "UNAUTHORIZED", message: "invalid token" } });
      return;
    }
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
      const status = e instanceof ExtensionDisconnectedError ? 503 : 400;
      json(res, status, { error: { code: e.code || "ERROR", message: e.message } });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname !== "/host" || tokenOf(req, url) !== options.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      session.attach(ws);
    });
  });

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
        mcpCommand,
        lastError: extensionError,
        tools: TOOLS.map((t) => t.name),
      };
    }
    if (INTERACTIVE_TOOLS.has(method) && !session.connected) {
      throw new ExtensionDisconnectedError();
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

  return {
    host,
    port: addressPort(),
    token: options.token,
    session,
    mcpCommand,
    rpc,
    close: async () => {
      session.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
