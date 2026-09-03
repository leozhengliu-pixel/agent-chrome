import fs from "node:fs";
import { WebSocket } from "ws";
import { encodeLengthPrefixed, LengthPrefixedDecoder } from "../shared/framing.js";
import { VERSION } from "../shared/constants.js";
import type { RpcResponse } from "../shared/protocol.js";
import { isRpcRequest } from "../shared/protocol.js";
import { configDir, verifyBridgeProof } from "../shared/config.js";

export type HostStreams = {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  url: string;
  token: string;
  socketPath?: string;
  requireProof?: boolean;
  configDir?: string;
};

function log(streams: HostStreams, msg: string): void {
  streams.stderr?.write(`[agent-chrome-host] ${msg}\n`);
}

function writeNative(stdout: NodeJS.WritableStream, value: unknown): void {
  stdout.write(encodeLengthPrefixed(value));
}

export function runHost(streams: HostStreams): Promise<void> {
  const decoder = new LengthPrefixedDecoder();
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;

  function connect(): void {
    if (closed) return;
    if (streams.requireProof) {
      const check = verifyBridgeProof(streams.configDir || configDir());
      if (!check.ok) {
        log(streams, `not connecting with token: ${check.reason}`);
        scheduleReconnect();
        return;
      }
    }
    const headers = { Authorization: `Bearer ${streams.token}` };
    const sockPath = streams.socketPath;
    const useUnix = Boolean(sockPath && process.platform !== "win32" && fs.existsSync(sockPath));
    const ws = useUnix
      ? new WebSocket("ws://127.0.0.1/host", { headers, socketPath: sockPath })
      : new WebSocket(streams.url, { headers });
    socket = ws;

    ws.on("open", () => {
      log(streams, `connected to ${useUnix ? sockPath : streams.url}`);
      ws.send(JSON.stringify({ type: "hello", role: "host", version: VERSION }));
      writeNative(streams.stdout, { type: "bridge-status", connected: true });
    });

    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      writeNative(streams.stdout, parsed);
    });

    ws.on("close", () => {
      if (socket === ws) socket = null;
      writeNative(streams.stdout, { type: "bridge-status", connected: false });
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      log(streams, `websocket error: ${err.message}`);
    });
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1000);
  }

  streams.stdin.on("data", (chunk: Buffer) => {
    let messages: unknown[] = [];
    try {
      messages = decoder.push(chunk);
    } catch (err) {
      log(streams, `framing error: ${(err as Error).message}`);
      return;
    }
    for (const msg of messages) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      } else if (isRpcRequest(msg)) {
        const response: RpcResponse = {
          id: msg.id,
          error: {
            code: "BRIDGE_DISCONNECTED",
            message:
              "Native host is running but the local bridge is not. Start the Agent Chrome bridge with --mcp (see README).",
          },
        };
        writeNative(streams.stdout, response);
      }
    }
  });

  const finish = () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    socket?.close();
  };

  streams.stdin.on("end", finish);
  streams.stdin.on("close", finish);

  pingTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.ping();
      } catch {
        // ignore
      }
    }
  }, 15000);

  connect();

  return new Promise((resolve) => {
    streams.stdin.on("close", () => resolve());
    streams.stdin.on("end", () => resolve());
  });
}
