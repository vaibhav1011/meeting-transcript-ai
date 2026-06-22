import { env } from "./env.js";

function buildUrl(path) {
  return `${env.BACKEND_BASE_URL.replace(/\/$/, "")}${path}`;
}

async function post(path, body) {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Backend request failed: ${response.status} ${detail}`);
  }

  return response.json();
}

export const backendClient = {
  sendStatus(payload) {
    return post("/internal/meeting-status", payload);
  },
  sendAudioChunk(payload) {
    return post("/internal/audio-chunk", payload);
  }
};
