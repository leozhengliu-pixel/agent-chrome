import { TOOLS } from "../shared/tools.js";
import { MCP_SERVER_NAME, VERSION } from "../shared/constants.js";
import { NdjsonDecoder } from "../shared/framing.js";
import { ExtensionDisconnectedError } from "../shared/protocol.js";

export type RpcFn = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const PROTOCOL = "2024-11-05";

function toolResult(value: unknown, isError = false): {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
} {
  if (
    value &&
    typeof value === "object" &&
    "data" in (value as object) &&
    "mimeType" in (value as object) &&
    (value as { mimeType: string }).mimeType === "image/png"
  ) {
    const shot = value as { data: string; mimeType: string };
    const image = {
      content: [
        { type: "image" as const, data: shot.data, mimeType: shot.mimeType },
        { type: "text" as const, text: "screenshot captured (image/png)" },
      ],
    };
    return isError ? { ...image, isError: true } : image;
  }
  const text = {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
  return isError ? { ...text, isError: true } : text;
}

export async function handleMcp(rpc: RpcFn, message: JsonRpc): Promise<unknown> {
  const method = message.method || "";
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: MCP_SERVER_NAME, version: VERSION },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return undefined;
  }
  if (method === "ping") {
    return {};
  }
  if (method === "tools/list") {
    return {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  }
  if (method === "tools/call") {
    const name = String(message.params?.name || "");
    const args = (message.params?.arguments || {}) as Record<string, unknown>;
    if (!TOOLS.some((t) => t.name === name)) {
      return toolResult({ error: `Unknown tool: ${name}` }, true);
    }
    try {
      const result = await rpc(name, args);
      return toolResult(result);
    } catch (err) {
      const e = err as Error & { code?: string };
      const msg =
        e instanceof ExtensionDisconnectedError
          ? e.message
          : `${e.code ? `[${e.code}] ` : ""}${e.message}`;
      return toolResult({ error: msg }, true);
    }
  }
  throw new Error(`Unknown MCP method ${method}`);
}

export function startMcpStdio(
  rpc: RpcFn,
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const decoder = new NdjsonDecoder();

  const write = (payload: unknown) => {
    stdout.write(`${JSON.stringify(payload)}\n`);
  };

  stdin.on("data", (chunk) => {
    let messages: unknown[] = [];
    try {
      messages = decoder.push(chunk as Buffer);
    } catch (err) {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: (err as Error).message },
      });
      return;
    }
    for (const msg of messages) {
      void (async () => {
        const m = msg as JsonRpc;
        const id = m.id;
        if (!m.method) return;
        if (m.method.startsWith("notifications/") || id === undefined) {
          try {
            await handleMcp(rpc, m);
          } catch {
            // notifications do not reply
          }
          return;
        }
        try {
          const result = await handleMcp(rpc, m);
          write({ jsonrpc: "2.0", id, result });
        } catch (err) {
          write({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: (err as Error).message },
          });
        }
      })();
    }
  });

  return new Promise((resolve) => {
    stdin.on("end", () => resolve());
    stdin.on("close", () => resolve());
  });
}
