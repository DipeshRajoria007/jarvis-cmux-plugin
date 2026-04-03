import { $ } from "bun";
import { existsSync, statSync } from "fs";

const WHISPER_CLI = "whisper-cli";
const MODEL_PATH = new URL("../models/ggml-base.en.bin", import.meta.url).pathname;
const RECORD_SECONDS = 4;
const WAV_PATH = "/tmp/jarvis-voice.wav";

export async function recordAudio(seconds = RECORD_SECONDS): Promise<string> {
  // Record from default mic using ffmpeg
  // :0 = first audio device (MacBook Pro Microphone)
  try {
    await $`ffmpeg -f avfoundation -i ":0" -t ${seconds} -ar 16000 -ac 1 -y ${WAV_PATH}`.quiet();
  } catch {
    // ffmpeg returns non-zero sometimes even on success
  }

  if (!existsSync(WAV_PATH)) {
    throw new Error("Recording failed: no WAV file produced");
  }

  const size = statSync(WAV_PATH).size;
  if (size < 1000) {
    throw new Error(`Recording too small (${size} bytes), likely silence or error`);
  }

  return WAV_PATH;
}

export async function transcribe(wavPath: string): Promise<string> {
  const result =
    await $`${WHISPER_CLI} -m ${MODEL_PATH} -f ${wavPath} --no-timestamps -nt 2>/dev/null`.text();

  // Clean up whisper output — strip whitespace and [BLANK_AUDIO] markers
  return result
    .replace(/\[BLANK_AUDIO\]/g, "")
    .replace(/\n/g, " ")
    .trim();
}

export type VoiceCallback = (text: string) => void | Promise<void>;

export class VoiceLoop {
  private running = false;
  private callback: VoiceCallback;
  private recordSeconds: number;

  constructor(callback: VoiceCallback, recordSeconds = RECORD_SECONDS) {
    this.callback = callback;
    this.recordSeconds = recordSeconds;
  }

  async start() {
    this.running = true;
    console.log("[JARVIS] Voice loop started — listening...");

    while (this.running) {
      try {
        const wavPath = await recordAudio(this.recordSeconds);
        const text = await transcribe(wavPath);

        if (text && text.length > 2) {
          console.log(`[VOICE] "${text}"`);
          await this.callback(text);
        }
      } catch (err) {
        // Don't crash on transient errors, just keep listening
        console.error(`[VOICE] Error: ${err}`);
      }
    }
  }

  stop() {
    this.running = false;
    console.log("[JARVIS] Voice loop stopped");
  }
}
