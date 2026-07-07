# Meeting Transcript AI

An AI-powered meeting transcription and summarization platform. It joins your meetings 
automatically, captures real audio, transcribes and diarizes speakers, and turns the 
conversation into a structured summary with action items and tickets.

This is a four-service architecture: a React dashboard, a Node.js/Express backend, a 
Playwright-driven meeting bot, and a Python ML service for diarization and transcription.

## Features

- **Automated meeting join** — detects the platform (Google Meet, Zoom, or Teams) and 
  joins via a real Playwright browser session
- **Real audio capture** — captures actual system audio in chunks (not caption scraping)
- **Speaker diarization + transcription** — pyannote.audio for speaker labels, WhisperX 
  for timestamped transcription, with speaker embeddings kept consistent across chunks
- **Live transcript streaming** — segments stream to the dashboard over WebSockets as 
  the meeting happens
- **AI summaries** — full transcript sent to an OpenAI-compatible LLM for summary, action 
  items, and tickets after the meeting
- **Editable speaker labels** — rename speakers directly in the UI

## Architecture

1. The React dashboard calls `POST /start-meeting` on the backend.
2. The backend detects the meeting platform, creates a session in MongoDB, and dispatches 
   a bot job to `bot-service`.
3. `bot-service` launches Playwright, joins the meeting in-browser, and runs a real audio 
   capture command that writes 5–10 second WAV chunks.
4. Each chunk is posted to the backend at `/internal/audio-chunk`.
5. The backend forwards the chunk to `ml-service`.
6. `ml-service` runs diarization (pyannote.audio) and transcription (WhisperX), aligning 
   speaker embeddings across chunks for consistency, and returns structured transcript segments.
7. The backend stores segments in order, emits live updates over WebSockets, and on 
   `POST /process-meeting` sends the full transcript to an LLM for summary, action items, 
   and tickets.

## Project Structure

meeting-transcript-ai/
├── backend/
│   └── src/
│       ├── index.js
│       ├── lib/mongo.js
│       ├── models/Meeting.js
│       ├── server/
│       │   ├── app.js
│       │   ├── env.js
│       │   ├── socket.js
│       │   └── routes/meetings.js
│       └── services/
│           ├── botServiceClient.js
│           ├── llmService.js
│           ├── mlServiceClient.js
│           └── platforms.js
├── bot-service/
│   └── src/
│       ├── index.js
│       ├── browserBot.js
│       ├── audioStreamer.js
│       ├── backendClient.js
│       ├── env.js
│       └── platforms.js
├── frontend/
│   └── src/
│       ├── main.js
│       ├── api/client.js
│       ├── ws/socket.js
│       └── ui/
│           ├── App.js
│           └── styles.css
├── ml-service/
│   └── app/main.py
└── docker-compose.yml

## Tech Stack

| Layer            | Technology                                      |
|------------------|--------------------------------------------------|
| Frontend         | React (JavaScript)                                |
| Backend          | Node.js, Express, MongoDB, WebSockets             |
| Meeting Bot      | Playwright, FFmpeg (real audio capture)           |
| ML Service       | Python, WhisperX, pyannote.audio                  |
| LLM Integration  | OpenAI-compatible API (summary/action items)      |

## API Reference

**Backend**
| Method | Endpoint                     | Description                          |
|--------|-------------------------------|---------------------------------------|
| POST   | `/start-meeting`              | Starts a new meeting session          |
| POST   | `/transcript-chunk`           | Receives a transcript chunk           |
| GET    | `/meeting/:id`                 | Fetches a meeting's data              |
| POST   | `/process-meeting`             | Generates summary/action items/tickets|
| GET    | `/meetings`                    | Lists all meetings                    |
| PATCH  | `/meeting/:id/speakers`        | Updates speaker labels                |

**Bot Service**
| Method | Endpoint             | Description                    |
|--------|------------------------|----------------------------------|
| GET    | `/audio/devices`       | Lists available audio devices    |
| POST   | `/audio/test`          | Runs a test audio capture        |

**Internal (bot → backend)**
| Method | Endpoint                      | Description                  |
|--------|---------------------------------|--------------------------------|
| POST   | `/internal/meeting-status`     | Bot reports meeting status     |
| POST   | `/internal/audio-chunk`        | Bot forwards a captured chunk  |

## Environment Variables

**Backend** — see `backend/.env.example`
- `MONGODB_URI`
- `BOT_SERVICE_URL`
- `ML_SERVICE_URL`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

**Bot Service**
Requires a real system-audio capture command via `BOT_AUDIO_CAPTURE_COMMAND`.

Windows (FFmpeg + loopback-capable device):
```bash
ffmpeg -f dshow -i audio="virtual-audio-capturer" -ac {channels} -ar {sampleRate} -f segment -segment_time {chunkSeconds} {outputPattern}
```

Linux (PulseAudio):
```bash
ffmpeg -f pulse -i default -ac {channels} -ar {sampleRate} -f segment -segment_time {chunkSeconds} {outputPattern}
```

The placeholders `{chunkSeconds}`, `{outputPattern}`, `{sampleRate}`, `{channels}`, and 
`{durationSeconds}` are substituted automatically by the bot service — this is a real audio 
capture path, not caption scraping.

Other relevant env vars:
- `FFMPEG_PATH`
- `BOT_AUDIO_CAPTURE_COMMAND`
- `BOT_AUDIO_CHUNK_SECONDS`
- `BOT_AUDIO_SAMPLE_RATE`
- `BOT_AUDIO_CHANNELS`
- `BOT_AUDIO_TEST_DURATION_SECONDS`

**ML Service**
- `HF_TOKEN` — required for gated pyannote models
- `WHISPERX_MODEL=large-v3` — recommended
- GPU-enabled torch recommended for performance

## Running Locally

1. Copy environment templates:
```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
```
2. Set required variables: `HF_TOKEN`, `BOT_AUDIO_CAPTURE_COMMAND`
3. Start all services:
```bash
   docker compose up --build
```
4. Open:
   - Frontend: `http://localhost:5173`
   - Backend health: `http://localhost:8080/health`
   - Bot health: `http://localhost:8090/health`
   - ML health: `http://localhost:8000/health`
5. Verify audio before joining real meetings:
   - `GET http://localhost:8090/audio/devices`
   - `POST http://localhost:8090/audio/test`

## Test Flow

1. Start the stack.
2. Paste a meeting link into the dashboard.
3. Run the bot-service audio test and confirm chunk files are produced.
4. Confirm the bot joins the meeting in the Playwright browser.
5. Verify the backend receives `/internal/audio-chunk` requests.
6. Watch live transcript segments stream into the dashboard with stable speaker labels.
7. Rename speakers in the UI if needed.
8. Click **Process meeting**.
9. Confirm summary, action items, and tickets appear in the Insights panel.

## Notes

- `bot-service/` is the active automation service — the older `zoom-worker/` scaffold is 
  no longer part of `docker-compose.yml`.
- Frontend, backend, and bot service are all implemented in JavaScript.
- Real browser automation selectors differ by tenant/login flow. The bot service includes 
  platform-specific join strategies, but production deployment should tune selectors and 
  authentication state for your environment.
- Dockerized browser audio capture is host-specific. In many setups, the bot service runs 
  better on a host VM with Playwright + FFmpeg + loopback audio configured, while the 
  backend and ML service remain containerized.

## License
MIT
