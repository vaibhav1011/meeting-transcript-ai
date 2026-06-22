import { env } from "../server/env.js";

function buildUrl(path) {
  return `${env.ML_SERVICE_URL.replace(/\/$/, "")}${path}`;
}

export async function transcribeAudioChunk(payload) {
  const response = await fetch(buildUrl("/v1/transcribe-chunk"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ML service request failed: ${response.status} ${detail}`);
  }

  return response.json();
}
