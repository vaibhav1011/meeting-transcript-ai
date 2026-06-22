export function detectPlatform(meetingUrl) {
  const normalized = meetingUrl.toLowerCase();

  if (normalized.includes("meet.google.com")) return "google_meet";
  if (normalized.includes("zoom.us")) return "zoom";
  if (normalized.includes("teams.microsoft.com") || normalized.includes("teams.live.com")) {
    return "microsoft_teams";
  }

  throw new Error("Unsupported meeting URL. Expected Google Meet, Zoom, or Microsoft Teams.");
}
