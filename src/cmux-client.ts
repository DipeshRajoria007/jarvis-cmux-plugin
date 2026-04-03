import { connect, type Socket } from "net";

import { homedir } from "os";
import { join } from "path";

const SOCKET_PATH =
  process.env.CMUX_SOCKET ?? join(homedir(), "Library", "Application Support", "cmux", "cmux.sock");

type JsonRpcResponse = {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
};

export class CmuxClient {
  private reqId = 0;
  private socket: Socket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      this.socket = connect(SOCKET_PATH, () => {
        this.connected = true;
        resolve();
      });

      this.socket.on("data", (chunk) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });

      this.socket.on("error", (err) => {
        this.connected = false;
        reject(err);
      });

      this.socket.on("close", () => {
        this.connected = false;
        // Reject all pending requests
        for (const [, { reject }] of this.pending) {
          reject(new Error("Socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  private processBuffer() {
    // cmux sends newline-delimited JSON
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        const handler = this.pending.get(msg.id);
        if (handler) {
          this.pending.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(msg.error.message));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    }
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.socket || !this.connected) {
      throw new Error("Not connected to cmux socket");
    }

    const id = `req-${++this.reqId}`;
    const msg = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });

      this.socket!.write(msg, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });

      // Timeout after 5s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 5000);
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.call("system.ping");
      return true;
    } catch {
      return false;
    }
  }

  async listNotifications(): Promise<unknown[]> {
    return this.call<unknown[]>("notification.list");
  }

  async clearNotifications(): Promise<void> {
    await this.call("notification.clear");
  }

  async listWorkspaces(): Promise<unknown[]> {
    return this.call<unknown[]>("workspace.list");
  }

  async listSurfaces(): Promise<unknown[]> {
    return this.call<unknown[]>("surface.list");
  }

  async sendText(surfaceId: string, text: string): Promise<void> {
    await this.call("surface.send_text", { surface_id: surfaceId, text });
  }

  async sendKey(surfaceId: string, key: string): Promise<void> {
    await this.call("surface.send_key", { surface_id: surfaceId, key });
  }

  async setStatus(status: Record<string, unknown>): Promise<void> {
    await this.call("set_status", status);
  }

  async log(message: string): Promise<void> {
    await this.call("log", { message });
  }

  async identify(): Promise<unknown> {
    return this.call("system.identify");
  }

  async readSurfaceText(surfaceId: string): Promise<string> {
    const result = await this.call<{ text?: string }>("surface.read_text", { surface_id: surfaceId });
    return result?.text ?? "";
  }

  async createNotification(title: string, body: string, subtitle?: string): Promise<void> {
    await this.call("notification.create", { title, body, subtitle });
  }

  disconnect() {
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }

  get isConnected() {
    return this.connected;
  }
}
