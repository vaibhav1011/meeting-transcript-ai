import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBrowserChunkStreamer } from "./browserAudioCapture.js";
import { env } from "./env.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyTemplate(command, values) {
  return command.replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? "");
}

function buildOutputDir(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
}

async function readFileBase64(filePath) {
  const chunks = [];
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("base64");
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function collectChunkFiles(outputDir) {
  const files = (await readdir(outputDir).catch(() => [])).sort();
  return files.map((file) => path.join(outputDir, file));
}

export async function listWindowsAudioDevices() {
  return new Promise((resolve, reject) => {
    const child = spawn(env.FFMPEG_PATH, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      windowsHide: true
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", () => {
      const devices = [];
      const lines = stderr.split(/\r?\n/);
      let inAudioSection = false;

      for (const line of lines) {
        if (line.includes("DirectShow audio devices")) {
          inAudioSection = true;
          continue;
        }
        if (line.includes("DirectShow video devices")) {
          inAudioSection = false;
        }
        if (!inAudioSection) {
          continue;
        }
        const match = line.match(/"(.+?)"/);
        if (match) {
          devices.push(match[1]);
        }
      }

      resolve({
        ok: true,
        ffmpegPath: env.FFMPEG_PATH,
        devices: [...new Set(devices)]
      });
    });
  });
}

export async function testAudioCapture() {
  if (!env.BOT_AUDIO_CAPTURE_COMMAND) {
    throw new Error("BOT_AUDIO_CAPTURE_COMMAND is empty. Set it before running audio capture tests.");
  }

  const outputDir = buildOutputDir("meeting-bot-audio-test");
  await mkdir(outputDir, { recursive: true });

  const outputPattern = path.join(outputDir, "chunk-%05d.wav");
  const command = applyTemplate(env.BOT_AUDIO_CAPTURE_COMMAND, {
    outputPattern,
    chunkSeconds: String(env.BOT_AUDIO_CHUNK_SECONDS)
  });

  const child = spawn(command, {
    shell: true,
    stdio: "pipe"
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });

  await sleep(env.BOT_AUDIO_TEST_DURATION_SECONDS * 1000);
  child.kill("SIGTERM");
  const exitInfo = await waitForExit(child);
  const files = await collectChunkFiles(outputDir);

  const chunks = [];
  for (const file of files) {
    const details = await stat(file).catch(() => null);
    if (!details || details.size === 0) {
      continue;
    }
    chunks.push({
      file: path.basename(file),
      bytes: details.size,
      base64Preview: (await readFile(file, "base64")).slice(0, 60)
    });
  }

  await rm(outputDir, { recursive: true, force: true }).catch(() => {});

  return {
    ok: true,
    command,
    durationSeconds: env.BOT_AUDIO_TEST_DURATION_SECONDS,
    exitInfo,
    chunkCount: chunks.length,
    chunks,
    stderrTail: stderr.slice(-2000)
  };
}

export async function createFfmpegChunkStreamer({ meetingId, onChunk }) {
  if (!env.BOT_AUDIO_CAPTURE_COMMAND) {
    return null;
  }

  const outputDir = buildOutputDir(`meeting-bot-${meetingId}`);
  await mkdir(outputDir, { recursive: true });

  const outputPattern = path.join(outputDir, "chunk-%05d.wav");
  const command = applyTemplate(env.BOT_AUDIO_CAPTURE_COMMAND, {
    outputPattern,
    chunkSeconds: String(env.BOT_AUDIO_CHUNK_SECONDS)
  });

  const child = spawn(command, {
    shell: true,
    stdio: "pipe"
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  let stopped = false;
  let sequence = 0;
  const seenFiles = new Set();
  const pendingFiles = new Map();

  const watchLoop = (async () => {
    while (!stopped) {
      const files = (await readdir(outputDir).catch(() => [])).sort();
      for (const file of files) {
        const fullPath = path.join(outputDir, file);
        if (seenFiles.has(fullPath)) continue;

        const details = await stat(fullPath).catch(() => null);
        if (!details || details.size === 0) continue;

        const previous = pendingFiles.get(fullPath);
        if (!previous || previous.size !== details.size) {
          pendingFiles.set(fullPath, { size: details.size });
          continue;
        }

        seenFiles.add(fullPath);
        pendingFiles.delete(fullPath);
        const audioBase64 = await readFileBase64(fullPath);
        await onChunk({
          chunkId: `${meetingId}-${String(sequence).padStart(5, "0")}`,
          sequence,
          audioBase64,
          mimeType: "audio/wav",
          sampleRate: 16000
        });
        sequence += 1;
        await unlink(fullPath).catch(() => {});
      }

      await sleep(1000);
    }
  })();

  return {
    type: "ffmpeg",
    async stop() {
      stopped = true;
      child.kill("SIGTERM");
      await watchLoop;
      await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

export async function createAudioStreamer({ page, meetingId, onChunk, phase = "beforeJoin" }) {
  if (env.BOT_AUDIO_CAPTURE_MODE === "off") {
    return null;
  }

  if (
    phase === "beforeJoin" &&
    page &&
    (env.BOT_AUDIO_CAPTURE_MODE === "browser" || env.BOT_AUDIO_CAPTURE_MODE === "auto")
  ) {
    try {
      return await createBrowserChunkStreamer({
        page,
        meetingId,
        chunkSeconds: env.BOT_AUDIO_CHUNK_SECONDS,
        onChunk
      });
    } catch (error) {
      if (env.BOT_AUDIO_CAPTURE_MODE === "browser") {
        throw error;
      }

      console.warn(
        `[bot-service] browser audio capture unavailable for ${meetingId}; ${
          env.BOT_AUDIO_CAPTURE_COMMAND ? "will try ffmpeg after join" : "no ffmpeg fallback configured"
        }`,
        error
      );
      return null;
    }
  }

  if (
    phase === "afterJoin" &&
    (env.BOT_AUDIO_CAPTURE_MODE === "ffmpeg" ||
      (env.BOT_AUDIO_CAPTURE_MODE === "auto" && env.BOT_AUDIO_CAPTURE_COMMAND))
  ) {
    return createFfmpegChunkStreamer({ meetingId, onChunk });
  }

  return null;
}
