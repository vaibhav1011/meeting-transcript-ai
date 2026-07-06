# Meeting Transcript AI 🎙️

An AI-powered meeting transcription and summarization platform that joins your online 
meetings, captures the conversation, and turns it into structured, speaker-aware notes — 
summaries, action items, and searchable transcripts — automatically.

## Features

- **Automated meeting join** — joins Google Meet, Zoom, or Microsoft Teams via a shared 
  link, with platform detection and pre-join workflow handling
- **Real-time audio capture** — records meeting audio through a browser bot service
- **Speaker-aware transcription** — uses WhisperX for accurate, timestamped transcription 
  and pyannote.audio for speaker diarization (who said what, and when)
- **AI-generated summaries** — converts raw transcripts into structured summaries, action 
  items, and follow-up tickets
- **Chrome extension** — lightweight in-browser controls to trigger and manage bot joins
- **Full-stack dashboard** — view past meetings, transcripts, and summaries in one place

## Architecture
meeting-transcript-ai/
├── frontend/       # React dashboard — view meetings, transcripts, summaries
├── backend/        # Node.js + Express API — auth, meeting metadata, orchestration
├── bot-service/     # Playwright-based automation — joins meetings, captures audio
├── ml-service/      # Python microservice — WhisperX transcription + speaker diarization
├── extension/       # Chrome extension for triggering/managing meeting bots
└── docker-compose.yml
## Tech Stack

| Layer            | Technology                                   |
|------------------|-----------------------------------------------|
| Frontend         | React                                         |
| Backend API      | Node.js, Express, MongoDB                     |
| Meeting Bot      | Playwright (browser automation)               |
| ML/Transcription | Python, WhisperX, pyannote.audio               |
| Browser Extension| JavaScript (Chrome Extension APIs)            |
| Infra            | Docker, Docker Compose                        |

## How It Works

1. User submits a meeting link through the dashboard or Chrome extension.
2. The **bot-service** launches a headless/automated browser session (via Playwright) 
   that joins the meeting on the detected platform (Meet/Zoom/Teams).
3. Audio is captured during the session and streamed/passed to the **ml-service**.
4. WhisperX transcribes the audio with word-level timestamps; pyannote.audio assigns 
   speaker labels to each transcript segment.
5. The processed transcript is stored via the **backend** (MongoDB) and surfaced on the 
   **frontend** dashboard as a structured summary with action items.

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+
- Docker & Docker Compose
- MongoDB (or use the provided Docker service)

### Setup
```bash
git clone https://github.com/vaibhav1011/meeting-transcript-ai.git
cd meeting-transcript-ai
docker-compose up --build
```

This spins up the frontend, backend, bot-service, and ml-service together.

### Environment Variables
Create a `.env` file in `backend/` and `ml-service/` with the required keys 
(MongoDB URI, WhisperX model config, etc. — see each service's `.env.example`).

## Roadmap
- [ ] Support for recurring meeting auto-scheduling
- [ ] Slack/Notion export for summaries and action items
- [ ] Multi-language transcription support

## License
MIT
