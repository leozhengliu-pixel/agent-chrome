import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { ExtensionDisconnectedError, type RpcRequest, type RpcResponse } from "../shared/protocol.js";
import { VERSION } from "../shared/constants.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

type ConnectWaiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export class Session {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private connectWaiters: ConnectWaiter[] = [];
  lastHello: Record<string, unknown> | null = null;
  constructor(private mcpCommand = "") {}

  get connected(): boolean {
    return this.socket != null && this.socket.readyState === 1;
  }

  attach(socket: WebSocket): void {
    if (this.socket && this.socket !== socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
    }
    this.socket = socket;
    socket.on("message", (data) => this.onMessage(data.toString()));
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.flushDisconnected();
    });
    socket.on("error", () => {
      /* close handler will flush */
    });
    this.sendRaw({ type: "hello", role: "bridge", version: VERSION, mcpCommand: this.mcpCommand });
    this.flushConnectWaiters(true);
  }

  waitUntilConnected(timeoutMs: number): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const entry: ConnectWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.connectWaiters = this.connectWaiters.filter((w) => w !== entry);
          reject(ExtensionDisconnectedError.afterLaunchTimeout());
        }, timeoutMs),
      };
      this.connectWaiters.push(entry);
      if (this.connected) this.flushConnectWaiters(true);
    });
  }

  private onMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const msg = parsed as Record<string, unknown>;
    if (msg.type === "hello") {
      this.lastHello = msg;
      return;
    }
    if (typeof msg.id === "string" && ("result" in msg || "error" in msg)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      const resp = msg as unknown as RpcResponse;
      if (resp.error) {
        const err = new Error(resp.error.message);
        (err as Error & { code?: string }).code = resp.error.code;
        pending.reject(err);
      } else {
        pending.resolve(resp.result);
      }
    }
  }

  private sendRaw(value: unknown): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(value));
  }

  private flushConnectWaiters(success: boolean, err?: Error): void {
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (success) waiter.resolve();
      else waiter.reject(err || new ExtensionDisconnectedError());
    }
  }

  private flushDisconnected(): void {
    this.flushConnectWaiters(false);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new ExtensionDisconnectedError());
      this.pending.delete(id);
    }
  }

  async request(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<unknown> {
    if (!this.connected) throw new ExtensionDisconnectedError();
    const id = randomUUID();
    const req: RpcRequest = { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for extension response to ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.sendRaw(req);
    });
  }

  close(): void {
    this.flushDisconnected();
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = null;
  }
}
