import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Meeting } from "../../models/Meeting.js";
import { startBotJoin } from "../../services/botServiceClient.js";
import { processMeetingWithLlm } from "../../services/llmService.js";
import { transcribeAudioChunk } from "../../services/mlServiceClient.js";
import { detectPlatform } from "../../services/platforms.js";
import { env } from "../env.js";
import { getIo } from "../socket.js";

export const meetingsRouter = Router();

const StartMeetingSchema = z.object({
  meetingUrl: z.string().url(),
  title: z.string().min(1).optional(),
  language: z.string().min(2).optional(),
  botDisplayName: z.string().min(1).optional()
});

const TranscriptChunkSchema = z.object({
  meetingId: z.string().min(1),
  chunkId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  segments: z
    .array(
      z.object({
        speaker: z.string().min(1),
        text: z.string().min(1),
        start_time: z.number(),
        end_time: z.number(),
        confidence: z.number().optional(),
        words: z
          .array(
            z.object({
              word: z.string(),
              start: z.number(),
              end: z.number(),
              score: z.number().optional()
            })
          )
          .optional()
      })
    )
    .default([])
});

const AudioChunkSchema = z.object({
  meetingId: z.string().min(1),
  chunkId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/wav"),
  sampleRate: z.number().default(16000),
  language: z.string().min(2).optional()
});

const BotStatusSchema = z.object({
  meetingId: z.string().min(1),
  joinStatus: z.enum(["joining", "joined", "left", "failed"]),
  message: z.string().optional()
});

const SpeakerMappingSchema = z.object({
  speakerId: z.string().min(1),
  displayName: z.string().min(1)
});

async function appendSegments(meeting, payload) {
  const segments = payload.segments.map((segment) => ({
    chunkId: payload.chunkId,
    sequence: payload.sequence,
    speaker: segment.speaker,
    text: segment.text,
    startTime: segment.start_time,
    endTime: segment.end_time,
    confidence: segment.confidence,
    words: segment.words || []
  }));

  if (!segments.length) {
    return;
  }

  meeting.transcript.push(...segments);
  meeting.transcript.sort((left, right) => {
    if (left.startTime !== right.startTime) return left.startTime - right.startTime;
    return left.endTime - right.endTime;
  });

  meeting.stats.chunksReceived = Math.max(meeting.stats.chunksReceived, payload.sequence + 1);
  meeting.stats.transcriptSegments = meeting.transcript.length;
  meeting.stats.durationSeconds = Math.max(
    meeting.stats.durationSeconds,
    ...segments.map((segment) => segment.endTime)
  );
  meeting.status = "live";
  await meeting.save();

  getIo().to(`meeting:${meeting.meetingId}`).emit("transcript.chunk", {
    meetingId: meeting.meetingId,
    segments
  });
}

meetingsRouter.post("/start-meeting", async (request, response) => {
  const body = StartMeetingSchema.parse(request.body);
  const meetingId = nanoid(12);
  const platform = detectPlatform(body.meetingUrl);

  const meeting = await Meeting.create({
    meetingId,
    meetingUrl: body.meetingUrl,
    platform,
    title: body.title,
    language: body.language || env.DEFAULT_LANGUAGE,
    status: "joining",
    bot: {
      joinStatus: "joining",
      displayName: body.botDisplayName || env.BOT_DISPLAY_NAME
    }
  });

  await startBotJoin({
    meetingId,
    meetingUrl: meeting.meetingUrl,
    platform: meeting.platform,
    language: meeting.language,
    botDisplayName: meeting.bot.displayName
  });

  response.json({
    meetingId: meeting.meetingId,
    platform: meeting.platform,
    status: meeting.status
  });
});

meetingsRouter.post("/transcript-chunk", async (request, response) => {
  const body = TranscriptChunkSchema.parse(request.body);
  const meeting = await Meeting.findOne({ meetingId: body.meetingId });

  if (!meeting) {
    return response.status(404).json({ error: "Meeting not found" });
  }

  await appendSegments(meeting, body);
  response.json({ ok: true, segmentsStored: body.segments.length });
});

meetingsRouter.post("/internal/audio-chunk", async (request, response) => {
  const body = AudioChunkSchema.parse(request.body);
  const meeting = await Meeting.findOne({ meetingId: body.meetingId });

  if (!meeting) {
    return response.status(404).json({ error: "Meeting not found" });
  }

  let mlResponse;
  try {
    mlResponse = await transcribeAudioChunk({
      meeting_id: body.meetingId,
      chunk_id: body.chunkId,
      sequence: body.sequence,
      language: body.language || meeting.language,
      mime_type: body.mimeType,
      sample_rate: body.sampleRate,
      audio_base64: body.audioBase64
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    meeting.bot.lastError = message;
    await meeting.save();
    getIo().to(`meeting:${meeting.meetingId}`).emit("meeting.updated", {
      meetingId: meeting.meetingId,
      status: meeting.status,
      bot: meeting.bot
    });
    return response.status(502).json({ error: message });
  }

  await appendSegments(meeting, {
    meetingId: body.meetingId,
    chunkId: body.chunkId,
    sequence: body.sequence,
    segments: mlResponse.segments || []
  });

  response.json({ ok: true, segmentsStored: (mlResponse.segments || []).length });
});

meetingsRouter.post("/internal/meeting-status", async (request, response) => {
  const body = BotStatusSchema.parse(request.body);
  const meeting = await Meeting.findOne({ meetingId: body.meetingId });

  if (!meeting) {
    return response.status(404).json({ error: "Meeting not found" });
  }

  meeting.bot.joinStatus = body.joinStatus;
  meeting.bot.lastError = body.message;

  if (body.joinStatus === "joined") {
    meeting.status = "live";
    meeting.bot.joinedAt = new Date();
  }

  if (body.joinStatus === "left") {
    meeting.status = "ended";
    meeting.bot.leftAt = new Date();
  }

  if (body.joinStatus === "failed") {
    meeting.status = "failed";
  }

  await meeting.save();

  getIo().to(`meeting:${meeting.meetingId}`).emit("meeting.updated", {
    meetingId: meeting.meetingId,
    status: meeting.status,
    bot: meeting.bot
  });

  response.json({ ok: true });
});

meetingsRouter.get("/meetings", async (_request, response) => {
  const meetings = await Meeting.find({}, { transcript: 0 }).sort({ createdAt: -1 }).lean();
  response.json({ meetings });
});

meetingsRouter.get("/meeting/:meetingId", async (request, response) => {
  const { meetingId } = z.object({ meetingId: z.string().min(1) }).parse(request.params);
  const meeting = await Meeting.findOne({ meetingId }).lean();

  if (!meeting) {
    return response.status(404).json({ error: "Meeting not found" });
  }

  response.json({ meeting });
});

meetingsRouter.post("/process-meeting", async (request, response) => {
  const { meetingId } = z.object({ meetingId: z.string().min(1) }).parse(request.body);
  const meeting = await Meeting.findOne({ meetingId });

  if (!meeting) {
    return response.status(404).json({ error: "Meeting not found" });
  }

  meeting.status = "processing";
  await meeting.save();

  const result = await processMeetingWithLlm(meeting);
  meeting.status = "processed";
  meeting.processing.summary = result.summary;
  meeting.processing.actionItems = result.action_items;
  meeting.processing.tickets = result.tickets;
  meeting.processing.processedAt = new Date();
  await meeting.save();

  getIo().to(`meeting:${meeting.meetingId}`).emit("meeting.processed", {
    meetingId: meeting.meetingId,
    processing: meeting.processing
  });

  response.json({
    meetingId: meeting.meetingId,
    summary: meeting.processing.summary,
    actionItems: meeting.processing.actionItems,
    tickets: meeting.processing.tickets
  });
});

meetingsRouter.patch("/meeting/:meetingId/speakers", async (request, response) => {
  const { meetingId } = z.object({ meetingId: z.string().min(1) }).parse(request.params);
  const body = z.object({ mappings: z.array(SpeakerMappingSchema) }).parse(request.body);
  const meeting = await Meeting.findOne({ meetingId });

  if (!meeting) {
    return response.status(404).json({ error: "Meeting not found" });
  }

  const merged = new Map(meeting.speakerMappings.map((mapping) => [mapping.speakerId, mapping.displayName]));
  for (const mapping of body.mappings) {
    merged.set(mapping.speakerId, mapping.displayName);
  }

  meeting.speakerMappings = Array.from(merged.entries()).map(([speakerId, displayName]) => ({
    speakerId,
    displayName
  }));

  await meeting.save();
  response.json({ ok: true, speakerMappings: meeting.speakerMappings });
});
