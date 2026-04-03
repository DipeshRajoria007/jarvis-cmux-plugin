import type { CmuxClient } from "./cmux-client.ts";

type Surface = {
  id: string;
  name?: string;
  title?: string;
  type?: string;
  focused?: boolean;
  [key: string]: unknown;
};

type RouteResult = {
  action: "send" | "send_focused" | "status" | "list" | "jarvis";
  surfaceId?: string;
  text?: string;
  raw: string;
};

// "tell session 2 to build the login page"
// "tell claude to fix the tests"
// "send to pane 1 run the migration"
// "in session 2, run the tests"
const SEND_PATTERNS = [
  /(?:tell|ask|send to)\s+(?:session|pane|claude|codex)?\s*(\w+)\s+(?:to\s+)?(.+)/i,
  /(?:in\s+)?(?:session|pane)\s*(\w+)\s*[,:]?\s*(.+)/i,
];

const STATUS_PATTERN = /(?:what'?s?\s+(?:running|happening|status)|status|show\s+status)/i;
const LIST_PATTERN = /(?:list|show)\s+(?:sessions?|panes?|agents?)/i;

// Conversational patterns Jarvis handles itself
const JARVIS_PATTERNS = [
  { pattern: /can you hear me/i, response: "Yes sir, I can hear you loud and clear." },
  { pattern: /hello|hey jarvis|hi jarvis/i, response: "Hello sir. How can I help?" },
  { pattern: /thank(?:s| you)/i, response: "You're welcome, sir." },
  { pattern: /stop|shut up|be quiet|quiet/i, response: "" }, // silence
  { pattern: /nevermind|never mind|cancel/i, response: "Understood." },
];

export class Router {
  private client: CmuxClient;
  private surfaces: Surface[] = [];

  constructor(client: CmuxClient) {
    this.client = client;
  }

  async refreshSurfaces() {
    try {
      this.surfaces = (await this.client.listSurfaces()) as Surface[];
    } catch {}
  }

  parse(text: string): RouteResult {
    // Jarvis conversational responses
    for (const { pattern, response } of JARVIS_PATTERNS) {
      if (pattern.test(text)) {
        return { action: "jarvis", text: response, raw: text };
      }
    }

    if (STATUS_PATTERN.test(text)) {
      return { action: "status", raw: text };
    }

    if (LIST_PATTERN.test(text)) {
      return { action: "list", raw: text };
    }

    // Try targeted send patterns
    for (const pat of SEND_PATTERNS) {
      const match = text.match(pat);
      if (match) {
        const target = match[1]!;
        const command = match[2]!.trim();
        const surface = this.resolveSurface(target);
        return { action: "send", surfaceId: surface?.id, text: command, raw: text };
      }
    }

    // Default: send to the focused session
    return { action: "send_focused", text: text, raw: text };
  }

  private resolveSurface(target: string): Surface | undefined {
    const idx = parseInt(target, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= this.surfaces.length) {
      return this.surfaces[idx - 1];
    }

    const lower = target.toLowerCase();
    return this.surfaces.find(
      (s) =>
        s.name?.toLowerCase().includes(lower) ||
        s.title?.toLowerCase().includes(lower) ||
        s.id?.toLowerCase().includes(lower)
    );
  }

  private getFocusedSurface(): Surface | undefined {
    return this.surfaces.find((s) => s.focused);
  }

  async execute(result: RouteResult): Promise<string> {
    switch (result.action) {
      case "jarvis":
        return result.text ?? "";

      case "send": {
        if (!result.surfaceId) {
          return "I don't know which session to send that to.";
        }
        await this.client.sendText(result.surfaceId, result.text!);
        await this.client.sendKey(result.surfaceId, "Enter");
        return `Sent to session.`;
      }

      case "send_focused": {
        const focused = this.getFocusedSurface();
        if (!focused) {
          return "No focused session to send to.";
        }
        await this.client.sendText(focused.id, result.text!);
        await this.client.sendKey(focused.id, "Enter");
        const name = focused.title ?? focused.name ?? "active session";
        return `Sent to ${name}.`;
      }

      case "status": {
        await this.refreshSurfaces();
        if (this.surfaces.length === 0) return "No active sessions.";
        const names = this.surfaces.map((s, i) => `${i + 1}. ${s.title ?? s.name ?? s.id}`).join(", ");
        return `Active sessions: ${names}`;
      }

      case "list": {
        await this.refreshSurfaces();
        if (this.surfaces.length === 0) return "No sessions found.";
        return this.surfaces
          .map((s, i) => `${i + 1}. ${s.title ?? s.name ?? s.id} (${s.type ?? "unknown"})`)
          .join("\n");
      }
    }
  }
}
