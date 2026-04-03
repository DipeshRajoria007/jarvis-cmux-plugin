import { $ } from "bun";

let speaking = false;

export async function speak(text: string, voice = "Samantha"): Promise<void> {
  if (speaking) return; // Don't queue up, skip if already talking
  speaking = true;
  try {
    await $`say -v ${voice} -r 200 ${text}`.quiet();
  } finally {
    speaking = false;
  }
}

export async function speakJarvis(text: string): Promise<void> {
  console.log(`[JARVIS] ${text}`);
  await speak(text);
}
