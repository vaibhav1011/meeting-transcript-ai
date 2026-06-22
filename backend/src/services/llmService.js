import { env } from "../server/env.js";

function normalizeJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (_error) {
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1]);
    }
    throw new Error("LLM response was not valid JSON");
  }
}

function formatTranscript(meeting) {
  return meeting.transcript
    .slice()
    .sort((left, right) => left.startTime - right.startTime)
    .map((segment) => {
      const label =
        meeting.speakerMappings.find((entry) => entry.speakerId === segment.speaker)?.displayName ||
        segment.speaker;
      return `[${segment.startTime.toFixed(2)}-${segment.endTime.toFixed(2)}] ${label}: ${segment.text}`;
    })
    .join("\n");
}

export async function processMeetingWithLlm(meeting) {
  const transcript = formatTranscript(meeting);
  if (!transcript.trim()) {
    return { summary: "", action_items: [], tickets: [] };
  }

  const response = await fetch(`${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.LLM_API_KEY ? { Authorization: `Bearer ${env.LLM_API_KEY}` } : {})
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return strict JSON with keys summary, action_items, tickets. action_items is an array of {text, owner?, dueDate?}. tickets is an array of {title, description, assignee?, priority}. Priority must be low, medium, high, or urgent."
        },
        {
          role: "user",
          content: `Meeting transcript:\n${transcript}`
        }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LLM processing failed: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content ?? "{}";
  const parsed = normalizeJson(content);

  return {
    summary: parsed.summary || "",
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    tickets: Array.isArray(parsed.tickets) ? parsed.tickets : []
  };
}
