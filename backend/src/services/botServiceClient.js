import { env } from "../server/env.js";

function buildUrl(path) {
  return `${env.BOT_SERVICE_URL.replace(/\/$/, "")}${path}`;
}

export async function startBotJoin(payload) {
  const response = await fetch(buildUrl("/join"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Bot service request failed: ${response.status} ${detail}`);
  }

  return response.json();
}
