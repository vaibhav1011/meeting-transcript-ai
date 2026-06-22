import express from "express";
import { z } from "zod";
import { listWindowsAudioDevices, testAudioCapture } from "./audioStreamer.js";
import { closeLoginSession, joinMeeting, openLoginSession } from "./browserBot.js";
import { env } from "./env.js";
import { detectPlatform } from "./platforms.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const JoinSchema = z.object({
  meetingId: z.string().min(1),
  meetingUrl: z.string().url(),
  platform: z.enum(["google_meet", "zoom", "microsoft_teams"]).optional(),
  language: z.string().min(2).optional(),
  botDisplayName: z.string().min(1)
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    audioCaptureMode: env.BOT_AUDIO_CAPTURE_MODE,
    audioConfigured:
      env.BOT_AUDIO_CAPTURE_MODE === "browser" ||
      Boolean(env.BOT_AUDIO_CAPTURE_COMMAND) ||
      env.BOT_AUDIO_CAPTURE_MODE === "auto",
    ffmpegPath: env.FFMPEG_PATH
  });
});

app.get("/audio/devices", async (_request, response) => {
  try {
    const result = await listWindowsAudioDevices();
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list audio devices"
    });
  }
});

app.post("/audio/test", async (_request, response) => {
  try {
    const result = await testAudioCapture();
    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Audio capture test failed"
    });
  }
});

app.post("/login/open", async (request, response) => {
  const body = z
    .object({
      url: z.string().url().optional()
    })
    .parse(request.body || {});

  const result = await openLoginSession(body.url || "https://accounts.google.com");
  response.json(result);
});

app.post("/login/close", async (_request, response) => {
  const result = await closeLoginSession();
  response.json(result);
});

app.post("/join", async (request, response) => {
  const body = JoinSchema.parse(request.body);
  const platform = body.platform || detectPlatform(body.meetingUrl);

  void joinMeeting({ ...body, platform }).catch((error) => {
    console.error("[bot-service] join failed", error);
  });

  response.json({
    ok: true,
    accepted: true,
    meetingId: body.meetingId,
    platform
  });
});

app.listen(env.BOT_PORT, () => {
  console.log(`[bot-service] listening on :${env.BOT_PORT}`);
});
