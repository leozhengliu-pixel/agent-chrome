import { WebSocket } from "ws";
import { encodeLengthPrefixed, LengthPrefixedDecoder } from "../shared/framing.js";
import { VERSION } from "../shared/constants.js";
import type { RpcResponse } from "../shared/protocol.js";
import { isRpcRequest } from "../shared/protocol.js";

export type HostStreams = {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  url: string;
  token: string;
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
    const ws = new WebSocket(streams.url, {
      headers: { Authorization: `Bearer ${streams.token}` },
    });
    socket = ws;

    ws.on("open", () => {
      log(streams, `connected to ${streams.url}`);
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
