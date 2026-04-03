import type { CmuxClient } from "./cmux-client.ts";
import { speakJarvis } from "./speaker.ts";

type Surface = {
  id: string;
  title?: string;
  type?: string;
  focused?: boolean;
  [key: string]: unknown;
};

type SessionSnapshot = {
  surfaceId: string;
  title: string;
  lastContent: string;
  lastActivity: number;
  status: "idle" | "busy" | "waiting" | "done";
};

/**
 * MetaAgent monitors all cmux sessions, detects state changes,
 * and provides intelligent narration about what's happening.
 */
export class MetaAgent {
  private client: CmuxClient;
  private sessions = new Map<string, SessionSnapshot>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private pollMs: number;

  constructor(client: CmuxClient, pollMs = 3000) {
    this.client = client;
    this.pollMs = pollMs;
  }

  start() {
    if (this.interval) return;
    console.log("[META] Agent monitor started");
    this.interval = setInterval(() => this.scan(), this.pollMs);
    this.scan();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async scan() {
    try {
      const surfaces = (await this.client.listSurfaces()) as Surface[];

      for (const surface of surfaces) {
        if (surface.type !== "terminal") continue;

        const id = surface.id;
        const title = surface.title ?? id;

        // Read current terminal content (last ~200 chars for diff)
        let content: string;
        try {
          const fullText = await this.client.readSurfaceText(id);
          content = fullText.slice(-500);
        } catch {
          continue;
        }

        const prev = this.sessions.get(id);
        const now = Date.now();

        if (!prev) {
          // New session detected
          const status = this.inferStatus(content);
          this.sessions.set(id, { surfaceId: id, title, lastContent: content, lastActivity: now, status });
          continue;
        }

        // Content changed — something happened
        if (content !== prev.lastContent) {
          const newStatus = this.inferStatus(content);
          const oldStatus = prev.status;

          prev.lastContent = content;
          prev.lastActivity = now;
          prev.title = title;

          // Detect meaningful transitions
          if (oldStatus === "busy" && newStatus === "waiting") {
            await this.announce(`${title} finished and is waiting for input.`);
            await this.updateSidebar();
          } else if (oldStatus === "busy" && newStatus === "done") {
            await this.announce(`${title} completed its task.`);
            await this.updateSidebar();
          } else if (oldStatus !== "busy" && newStatus === "busy") {
            // Started working — just update sidebar, don't speak
            await this.updateSidebar();
          }

          prev.status = newStatus;
        }
      }
    } catch {
      // Socket error — skip this cycle
    }
  }

  private inferStatus(content: string): SessionSnapshot["status"] {
    const tail = content.slice(-300).toLowerCase();

    // Claude Code / Codex patterns for "waiting for input"
    if (
      tail.includes("waiting for your") ||
      tail.includes("what would you like") ||
      tail.includes("how can i help") ||
      tail.includes("> ") && tail.trimEnd().endsWith(">")
    ) {
      return "waiting";
    }

    // Completed patterns
    if (
      tail.includes("all tests passed") ||
      tail.includes("build succeeded") ||
      tail.includes("done!") ||
      tail.includes("completed successfully")
    ) {
      return "done";
    }

    // Active patterns — tool calls, file writes, running commands
    if (
      tail.includes("running") ||
      tail.includes("writing") ||
      tail.includes("reading") ||
      tail.includes("searching") ||
      tail.includes("editing") ||
      tail.includes("⠋") || tail.includes("⠙") || tail.includes("⠹") || // spinners
      tail.includes("...")
    ) {
      return "busy";
    }

    return "idle";
  }

  private async announce(message: string) {
    console.log(`[META] ${message}`);
    await speakJarvis(message);
  }

  private async updateSidebar() {
    try {
      const statusPills: Record<string, string> = {};
      for (const [, session] of this.sessions) {
        const emoji =
          session.status === "busy" ? "🔄" :
          session.status === "waiting" ? "⏳" :
          session.status === "done" ? "✅" : "💤";
        statusPills[session.title] = `${emoji} ${session.status}`;
      }
      await this.client.setStatus(statusPills);
    } catch {
      // Sidebar update failed — non-critical
    }
  }

  /** Get a summary of all monitored sessions */
  getSummary(): string {
    if (this.sessions.size === 0) return "No active sessions being monitored.";

    const lines: string[] = [];
    for (const [, s] of this.sessions) {
      lines.push(`${s.title}: ${s.status}`);
    }
    return lines.join(". ");
  }
}
