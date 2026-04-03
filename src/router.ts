import type { CmuxClient } from "./cmux-client.ts";

type Surface = {
  id: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
};

type RouteResult = {
  action: "send" | "status" | "list" | "unknown";
  surfaceId?: string;
  text?: string;
  raw: string;
};

// Patterns:
// "tell session 2 to build the login page"
// "tell claude to fix the tests"
// "send to pane 1 run the migration"
// "what's running" / "status"
// "list sessions"

const SEND_PATTERNS = [
  /(?:tell|ask|send to)\s+(?:session|pane|claude|codex)?\s*(\w+)\s+(?:to\s+)?(.+)/i,
  /(?:in\s+)?(?:session|pane)\s*(\w+)\s*[,:]?\s*(.+)/i,
];

const STATUS_PATTERN = /(?:what'?s?\s+(?:running|happening|status)|status|show\s+status)/i;
const LIST_PATTERN = /(?:list|show)\s+(?:sessions?|panes?|agents?)/i;

export class Router {
  private client: CmuxClient;
  private surfaces: Surface[] = [];

  constructor(client: CmuxClient) {
    this.client = client;
  }

  async refreshSurfaces() {
    try {
      this.surfaces = (await this.client.listSurfaces()) as Surface[];
    } catch {
      // Keep stale list if refresh fails
    }
  }

  parse(text: string): RouteResult {
    // Check status first
    if (STATUS_PATTERN.test(text)) {
      return { action: "status", raw: text };
    }

    if (LIST_PATTERN.test(text)) {
      return { action: "list", raw: text };
    }

    // Try send patterns
    for (const pattern of SEND_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const target = match[1]!;
        const command = match[2]!.trim();
        const surface = this.resolveSurface(target);
        return {
          action: "send",
          surfaceId: surface?.id,
          text: command,
          raw: text,
        };
      }
    }

    return { action: "unknown", raw: text };
  }

  private resolveSurface(target: string): Surface | undefined {
    // Try exact match by index (1-based)
    const idx = parseInt(target, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= this.surfaces.length) {
      return this.surfaces[idx - 1];
    }

    // Try name match
    const lower = target.toLowerCase();
    return this.surfaces.find(
      (s) => s.name?.toLowerCase().includes(lower) || s.id?.toLowerCase().includes(lower)
    );
  }

  async execute(result: RouteResult): Promise<string> {
    switch (result.action) {
      case "send": {
        if (!result.surfaceId) {
          return "I don't know which session to send that to.";
        }
        if (!result.text) {
          return "No command to send.";
        }
        await this.client.sendText(result.surfaceId, result.text);
        await this.client.sendKey(result.surfaceId, "Enter");
        return `Sent to session: "${result.text}"`;
      }

      case "status": {
        await this.refreshSurfaces();
        if (this.surfaces.length === 0) return "No active sessions.";
        const names = this.surfaces.map((s, i) => `${i + 1}. ${s.name ?? s.id}`).join(", ");
        return `Active sessions: ${names}`;
      }

      case "list": {
        await this.refreshSurfaces();
        if (this.surfaces.length === 0) return "No sessions found.";
        return this.surfaces
          .map((s, i) => `${i + 1}. ${s.name ?? s.id} (${s.type ?? "unknown"})`)
          .join("\n");
      }

      case "unknown":
        return `I didn't understand: "${result.raw}"`;
    }
  }
}
