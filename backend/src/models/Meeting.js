import mongoose, { Schema } from "mongoose";

const WordSchema = new Schema(
  {
    word: { type: String, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    score: { type: Number, required: false }
  },
  { _id: false }
);

const TranscriptSegmentSchema = new Schema(
  {
    chunkId: { type: String, required: true },
    sequence: { type: Number, required: true },
    speaker: { type: String, required: true },
    text: { type: String, required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    confidence: { type: Number, required: false },
    words: { type: [WordSchema], default: [] }
  },
  { _id: false }
);

const ActionItemSchema = new Schema(
  {
    text: { type: String, required: true },
    owner: { type: String, required: false },
    dueDate: { type: String, required: false }
  },
  { _id: false }
);

const TicketSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    assignee: { type: String, required: false },
    priority: { type: String, required: true, enum: ["low", "medium", "high", "urgent"] }
  },
  { _id: false }
);

const SpeakerMappingSchema = new Schema(
  {
    speakerId: { type: String, required: true },
    displayName: { type: String, required: true }
  },
  { _id: false }
);

const MeetingSchema = new Schema(
  {
    meetingId: { type: String, required: true, unique: true, index: true },
    meetingUrl: { type: String, required: true },
    platform: { type: String, required: true, enum: ["google_meet", "zoom", "microsoft_teams"] },
    title: { type: String, required: false },
    language: { type: String, required: true, default: "en" },
    status: {
      type: String,
      required: true,
      enum: ["created", "joining", "live", "ended", "processing", "processed", "failed"],
      default: "created"
    },
    bot: {
      joinStatus: { type: String, required: true, default: "pending" },
      displayName: { type: String, required: true },
      joinedAt: { type: Date, required: false },
      leftAt: { type: Date, required: false },
      lastError: { type: String, required: false }
    },
    transcript: { type: [TranscriptSegmentSchema], default: [] },
    processing: {
      summary: { type: String, required: false },
      actionItems: { type: [ActionItemSchema], default: [] },
      tickets: { type: [TicketSchema], default: [] },
      processedAt: { type: Date, required: false }
    },
    speakerMappings: { type: [SpeakerMappingSchema], default: [] },
    stats: {
      chunksReceived: { type: Number, required: true, default: 0 },
      transcriptSegments: { type: Number, required: true, default: 0 },
      durationSeconds: { type: Number, required: true, default: 0 }
    }
  },
  { timestamps: true }
);

export const Meeting = mongoose.models.Meeting || mongoose.model("Meeting", MeetingSchema);
