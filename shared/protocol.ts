export type RpcRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type RpcError = {
  code: string;
  message: string;
};

export type RpcResponse = {
  id: string;
  result?: unknown;
  error?: RpcError;
};

export type HostHello = {
  type: "hello";
  role: "host";
  version: string;
};

export type BridgeHello = {
  type: "hello";
  role: "bridge";
  version: string;
  mcpCommand?: string;
};

export function isRpcRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.method === "string";
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && ("result" in v || "error" in v) && !("method" in v);
}

export class ExtensionDisconnectedError extends Error {
  readonly code = "EXTENSION_DISCONNECTED";
  constructor(
    message = "Agent Chrome extension is disconnected. Load the unpacked extension, keep Chrome open, and confirm the popup shows Connected.",
  ) {
    super(message);
    this.name = "ExtensionDisconnectedError";
  }

  static afterLaunchTimeout(): ExtensionDisconnectedError {
    return new ExtensionDisconnectedError(
      "Chrome was launched but the extension did not connect. Load the unpacked extension (ID pikkhapdmpoooagfjiogpjaleapphnmh) and keep it enabled. If Chrome is already running, the extension may not be loaded in this profile.",
    );
  }
}
