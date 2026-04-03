import { CmuxClient } from "./cmux-client.ts";
import { EventListener } from "./event-listener.ts";
import { speak, speakJarvis } from "./speaker.ts";
import { VoiceLoop } from "./voice-loop.ts";
import { Router } from "./router.ts";

const client = new CmuxClient();
const router = new Router(client);

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

  // Voice loop — listen → transcribe → route → speak result
  const voiceLoop = new VoiceLoop(async (text) => {
    // Refresh surfaces before routing
    await router.refreshSurfaces();

    const parsed = router.parse(text);
    const response = await router.execute(parsed);
    await speakJarvis(response);
  });

  // Start voice loop in background (non-blocking)
  voiceLoop.start();

  // Speak startup confirmation
  await speakJarvis("Jarvis online. Listening.");

  // Keep alive
  process.on("SIGINT", () => {
    console.log("\n[JARVIS] Shutting down...");
    voiceLoop.stop();
    listener.stop();
    client.disconnect();
    process.exit(0);
  });
}

main();
