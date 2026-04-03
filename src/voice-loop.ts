import { $ } from "bun";
import { existsSync, unlinkSync } from "fs";
import { inCooldown } from "./speaker.ts";
import OpenAI from "openai";

const openai = new OpenAI();

const CHUNK_SECONDS = 1;          // Record in 1s chunks
const SILENCE_TIMEOUT_MS = 1500;  // 1.5s of silence = done speaking
const SPEECH_THRESHOLD_DB = -38;  // Above this = speech detected
const CHUNK_PATH = "/tmp/jarvis-chunk.wav";
const FINAL_PATH = "/tmp/jarvis-voice.wav";

/** Record a short audio chunk */
async function recordChunk(): Promise<string> {
  try {
    await $`ffmpeg -f avfoundation -i ":0" -t ${CHUNK_SECONDS} -ar 16000 -ac 1 -y ${CHUNK_PATH} 2>/dev/null`.quiet();
  } catch {}
  return CHUNK_PATH;
}

/** Get mean volume of a WAV file in dB */
async function getMeanVolume(wavPath: string): Promise<number> {
  try {
    const result = await $`ffmpeg -i ${wavPath} -af volumedetect -f null /dev/null 2>&1`.text();
    const match = result.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    if (match) return parseFloat(match[1]!);
  } catch {}
  return -99; // silence
}

/** Concatenate multiple WAV files into one */
async function concatWavs(paths: string[], output: string): Promise<void> {
  if (paths.length === 1) {
    await $`cp ${paths[0]} ${output}`.quiet();
    return;
  }
  // Build ffmpeg filter to concat
  const inputs = paths.flatMap((p) => ["-i", p]);
  const filter = `concat=n=${paths.length}:v=0:a=1`;
  await $`ffmpeg ${inputs} -filter_complex ${filter} -ar 16000 -ac 1 -y ${output} 2>/dev/null`.quiet();
}

/** Transcribe via OpenAI Whisper API */
async function transcribe(wavPath: string): Promise<string> {
  const file = Bun.file(wavPath);
  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
  });
  return response.text.trim();
}

export type VoiceCallback = (text: string) => void | Promise<void>;

export class VoiceLoop {
  private running = false;
  private callback: VoiceCallback;

  constructor(callback: VoiceCallback) {
    this.callback = callback;
  }

  async start() {
    this.running = true;
    console.log("[JARVIS] Voice loop started (VAD + OpenAI Whisper)...");

    while (this.running) {
      try {
        // Skip while Jarvis is speaking + 2s cooldown after
        if (inCooldown()) {
          await Bun.sleep(300);
          continue;
        }

        // Phase 1: Wait for speech to start
        const chunkPath = await recordChunk();
        const vol = await getMeanVolume(chunkPath);

        if (vol < SPEECH_THRESHOLD_DB) {
          // Silence — keep waiting
          continue;
        }

        // Phase 2: Speech detected! Collect chunks until silence
        console.log("[VOICE] Speech detected, listening...");
        const chunks: string[] = [];
        let chunkIdx = 0;

        // Save first chunk
        const firstChunk = `/tmp/jarvis-c${chunkIdx++}.wav`;
        await $`cp ${chunkPath} ${firstChunk}`.quiet();
        chunks.push(firstChunk);

        let silentSince: number | null = null;

        while (this.running) {
          const path = `/tmp/jarvis-c${chunkIdx++}.wav`;
          try {
            await $`ffmpeg -f avfoundation -i ":0" -t ${CHUNK_SECONDS} -ar 16000 -ac 1 -y ${path} 2>/dev/null`.quiet();
          } catch {}

          const chunkVol = await getMeanVolume(path);
          chunks.push(path);

          if (chunkVol < SPEECH_THRESHOLD_DB) {
            // Silence chunk
            if (!silentSince) silentSince = Date.now();
            if (Date.now() - silentSince >= SILENCE_TIMEOUT_MS) {
              break; // Done speaking
            }
          } else {
            silentSince = null; // Still talking
          }

          // Safety: max 30s recording
          if (chunks.length > 30) break;
        }

        // Phase 3: Concatenate and transcribe
        console.log(`[VOICE] Processing ${chunks.length} chunks...`);
        await concatWavs(chunks, FINAL_PATH);

        const text = await transcribe(FINAL_PATH);

        // Cleanup temp chunks
        for (const c of chunks) {
          try { unlinkSync(c); } catch {}
        }

        if (text && text.length > 1) {
          console.log(`[VOICE] "${text}"`);
          await this.callback(text);
        }
      } catch (err) {
        console.error(`[VOICE] Error: ${err}`);
      }
    }
  }

  stop() {
    this.running = false;
    console.log("[JARVIS] Voice loop stopped");
  }
}
