import { CmuxClient } from "./cmux-client.ts";
import { EventListener } from "./event-listener.ts";
import { speakJarvis } from "./speaker.ts";
import { VoiceLoop } from "./voice-loop.ts";
import { Router } from "./router.ts";
import { MetaAgent } from "./meta-agent.ts";

const client = new CmuxClient();
const router = new Router(client);
const meta = new MetaAgent(client);

async function main() {
  console.log("[JARVIS] Starting up...");

  // Connect to cmux
  try {
    await client.connect();
    console.log("[JARVIS] Connected to cmux socket");
  } catch (err) {
    console.error("[JARVIS] Cannot connect to cmux socket. Is cmux running?");
    console.error(`  Error: ${err}`);
    process.exit(1);
  }

  // Ping to verify
  const alive = await client.ping();
  if (alive) {
    console.log("[JARVIS] cmux is alive");
  } else {
    console.warn("[JARVIS] cmux ping failed, continuing anyway...");
  }

  // Load surfaces for routing
  await router.refreshSurfaces();

  // Event listener — speak notifications
  const listener = new EventListener(client, async (notification) => {
    const text =
      notification.body ??
      notification.message ??
      notification.title ??
      "Task completed";
    await speakJarvis(text);
  });
  listener.start();
  console.log("[JARVIS] Listening for notifications...");

  // Meta-agent — monitor all sessions, narrate state changes
  meta.start();
  console.log("[JARVIS] Meta-agent monitoring sessions...");

  // Voice loop — listen → transcribe → route → speak result
  const voiceLoop = new VoiceLoop(async (text) => {
    await router.refreshSurfaces();

    // Handle "status" or "what's happening" via meta-agent
    const lower = text.toLowerCase();
    if (lower.includes("status") || lower.includes("what's happening") || lower.includes("what is happening")) {
      const summary = meta.getSummary();
      await speakJarvis(summary);
      return;
    }

    const parsed = router.parse(text);
    const response = await router.execute(parsed);
    await speakJarvis(response);
  });
  voiceLoop.start();

  // Speak startup confirmation
  await speakJarvis("Jarvis online. Monitoring all sessions.");

  // Keep alive
  process.on("SIGINT", () => {
    console.log("\n[JARVIS] Shutting down...");
    voiceLoop.stop();
    meta.stop();
    listener.stop();
    client.disconnect();
    process.exit(0);
  });
}

main();
