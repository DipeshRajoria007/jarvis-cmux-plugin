import type { CmuxClient } from "./cmux-client.ts";

type Notification = {
  id?: string;
  title?: string;
  body?: string;
  message?: string;
  surface_id?: string;
  [key: string]: unknown;
};

type NotificationHandler = (notification: Notification) => void;

export class EventListener {
  private client: CmuxClient;
  private handler: NotificationHandler;
  private seenIds = new Set<string>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private pollMs: number;

  constructor(client: CmuxClient, handler: NotificationHandler, pollMs = 2000) {
    this.client = client;
    this.handler = handler;
    this.pollMs = pollMs;
  }

  /** Seed seen IDs with existing notifications so we don't speak old ones */
  async init() {
    try {
      const notifications = (await this.client.listNotifications()) as Notification[];
      if (Array.isArray(notifications)) {
        for (const n of notifications) {
          this.seenIds.add(n.id ?? JSON.stringify(n));
        }
        console.log(`[EVENTS] Skipping ${this.seenIds.size} existing notifications`);
      }
    } catch {}
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    try {
      const notifications = (await this.client.listNotifications()) as Notification[];
      if (!Array.isArray(notifications)) return;

      for (const n of notifications) {
        const id = n.id ?? JSON.stringify(n);
        if (!this.seenIds.has(id)) {
          this.seenIds.add(id);
          this.handler(n);
        }
      }
    } catch (err) {
      // Socket might not be ready yet — silently retry next poll
    }
  }
}
