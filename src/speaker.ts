import { $ } from "bun";

let speaking = false;
let lastSpokeAt = 0;

const COOLDOWN_MS = 2000; // Wait 2s after speaking before listening again

export function isSpeaking(): boolean {
  return speaking;
}

export function inCooldown(): boolean {
  return speaking || (Date.now() - lastSpokeAt < COOLDOWN_MS);
}

export async function speak(text: string, voice = "Samantha"): Promise<void> {
  if (speaking) return;
  speaking = true;
  try {
    await $`say -v ${voice} -r 200 ${text}`.quiet();
  } finally {
    speaking = false;
    lastSpokeAt = Date.now();
  }
}

export async function speakJarvis(text: string): Promise<void> {
  console.log(`[JARVIS] ${text}`);
  await speak(text);
}
