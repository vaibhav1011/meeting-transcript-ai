import { useCallback, useEffect, useMemo, useState } from "react";
import "./index.css";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.VITE_API_BASE ||
  "http://localhost:8080";

const navItems = [
  { label: "Dashboard", icon: "grid" },
  { label: "Meetings", icon: "calendar" },
  { label: "Tickets", icon: "check" },
  { label: "Settings", icon: "settings" }
];

function Icon({ name }) {
  const paths = {
    mic: (
      <>
        <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
        <path d="M12 18v3" />
        <path d="M8 21h8" />
      </>
    ),
    grid: (
      <>
        <path d="M4 4h6v6H4z" />
        <path d="M14 4h6v6h-6z" />
        <path d="M4 14h6v6H4z" />
        <path d="M14 14h6v6h-6z" />
      </>
    ),
    calendar: (
      <>
        <path d="M7 3v4" />
        <path d="M17 3v4" />
        <path d="M4 8h16" />
        <path d="M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
      </>
    ),
    check: (
      <>
        <path d="M20 7 10 17l-5-5" />
        <path d="M4 4h16v16H4z" />
      </>
    ),
    settings: (
      <>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06A2 2 0 1 1 7.03 3.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.16.37.37.7.6 1 .3.25.7.4 1.1.4H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.6Z" />
      </>
    ),
    bot: (
      <>
        <path d="M12 8V5" />
        <path d="M8 5h8" />
        <path d="M6 10h12v8H6z" />
        <path d="M9 14h.01" />
        <path d="M15 14h.01" />
        <path d="M4 13h2" />
        <path d="M18 13h2" />
      </>
    ),
    user: (
      <>
        <path d="M20 21a8 8 0 0 0-16 0" />
        <path d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
      </>
    ),
    arrow: <path d="M6 12h12m-5-5 5 5-5 5" />,
    down: <path d="M12 5v14m-7-7 7 7 7-7" />
  };

  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function formatStatus(status) {
  if (!status) return "Idle";
  return status.replace(/_/g, " ");
}

function isLiveStatus(status) {
  return ["joining", "live", "processing", "processed"].includes(status);
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return `${Math.round(value)}s`;
  return `${Math.round(value / 60)}m`;
}

function platformLabel(platform) {
  return {
    google_meet: "Google Meet",
    zoom: "Zoom",
    microsoft_teams: "Microsoft Teams"
  }[platform] || "Meeting";
}

function speakerKey(label) {
  const compact = String(label || "Speaker 1").replace(/\s+/g, "_").toUpperCase();
  return compact.startsWith("SPEAKER_") ? compact : compact.replace("SPEAKER", "SPEAKER_");
}

function App() {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [meetings, setMeetings] = useState([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState(null);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchMeetings = useCallback(async () => {
    const response = await fetch(`${API_BASE}/meetings`);
    if (!response.ok) {
      throw new Error("Failed to load meetings");
    }
    const data = await response.json();
    const nextMeetings = data.meetings || [];
    setMeetings(nextMeetings);
    setSelectedMeetingId((currentId) => currentId || nextMeetings[0]?.meetingId || null);
  }, []);

  const fetchMeeting = useCallback(async (meetingId) => {
    const response = await fetch(`${API_BASE}/meeting/${meetingId}`);
    if (!response.ok) {
      throw new Error("Failed to load meeting details");
    }
    const data = await response.json();
    setSelectedMeeting(data.meeting);
  }, []);

  useEffect(() => {
    fetchMeetings().catch((loadError) => {
      setError(loadError.message);
    });
  }, [fetchMeetings]);

  useEffect(() => {
    if (!selectedMeetingId) {
      setSelectedMeeting(null);
      return;
    }

    fetchMeeting(selectedMeetingId).catch((loadError) => {
      setError(loadError.message);
    });
  }, [fetchMeeting, selectedMeetingId]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchMeetings().catch(() => {});
      if (selectedMeetingId) {
        fetchMeeting(selectedMeetingId).catch(() => {});
      }
    }, 4000);

    return () => clearInterval(intervalId);
  }, [fetchMeeting, fetchMeetings, selectedMeetingId]);

  const selectedMeetingSummary = useMemo(
    () => meetings.find((meeting) => meeting.meetingId === selectedMeetingId) || null,
    [meetings, selectedMeetingId]
  );

  const transcriptSegments = useMemo(() => selectedMeeting?.transcript || [], [selectedMeeting]);
  const processing = useMemo(() => selectedMeeting?.processing || {}, [selectedMeeting]);
  const tickets = useMemo(() => processing.tickets || [], [processing]);
  const actionItems = useMemo(() => processing.actionItems || [], [processing]);
  const speakerMappings = useMemo(() => selectedMeeting?.speakerMappings || [], [selectedMeeting]);

  const speakers = useMemo(() => {
    const mapped = new Map(speakerMappings.map((entry) => [entry.speakerId, entry.displayName]));
    for (const segment of transcriptSegments) {
      if (!mapped.has(segment.speaker)) {
        mapped.set(segment.speaker, segment.speaker);
      }
    }
    return Array.from(mapped.entries()).map(([speakerId, displayName]) => ({
      speakerId,
      displayName
    }));
  }, [speakerMappings, transcriptSegments]);

  const meetingTitle =
    selectedMeeting?.title ||
    selectedMeetingSummary?.title ||
    selectedMeeting?.meetingId ||
    "Production Meeting Assistant";
  const meetingPlatform = platformLabel(selectedMeeting?.platform || selectedMeetingSummary?.platform);
  const meetingStatus = selectedMeeting?.status || selectedMeetingSummary?.status || "idle";
  const isLive = isLiveStatus(meetingStatus);
  const ticketCount = tickets.length;
  const meetingCount = meetings.length;
  const duration = selectedMeeting?.stats?.durationSeconds || 0;
  const chunkCount = selectedMeeting?.stats?.chunksReceived || 0;
  const participantCount = Math.max(speakers.length, selectedMeeting ? 1 : 0);

  async function handleStartMeeting(event) {
    event.preventDefault();
    setIsStarting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`${API_BASE}/start-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingUrl,
          title: undefined,
          language: "en",
          botDisplayName: "MeetAI"
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start meeting");
      }

      setSuccess(`Meeting request accepted: ${data.meetingId}`);
      setMeetingUrl("");
      await fetchMeetings();
      setSelectedMeetingId(data.meetingId);
    } catch (startError) {
      setError(startError.message || "Failed to start meeting");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleProcessMeeting() {
    if (!selectedMeetingId) {
      return;
    }

    setIsProcessing(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`${API_BASE}/process-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: selectedMeetingId })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to process meeting");
      }

      setSuccess("Meeting processed.");
      await fetchMeeting(selectedMeetingId);
      await fetchMeetings();
    } catch (processError) {
      setError(processError.message || "Failed to process meeting");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="dashboardShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <Icon name="mic" />
          </div>
          <div>
            <strong>MeetAI</strong>
            <span>LIT India - Internal Tool</span>
          </div>
        </div>

        <nav className="sideSection" aria-label="Primary navigation">
          <span className="sideLabel">Navigation</span>
          {navItems.map((item) => (
            <button className={`navItem ${item.label === "Dashboard" ? "active" : ""}`} key={item.label}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.label === "Meetings" ? <strong>{meetingCount}</strong> : null}
              {item.label === "Tickets" ? <strong>{ticketCount}</strong> : null}
            </button>
          ))}
        </nav>

        <div className="sideSection sessionSection">
          <span className="sideLabel">Active Session</span>
          <div className="sessionList">
            {meetings.length === 0 ? (
              <div className="sessionCard empty">
                <strong>No live calls</strong>
                <span>Start a meeting to begin capture</span>
              </div>
            ) : (
              meetings.slice(0, 5).map((meeting) => (
                <button
                  className={`sessionCard ${meeting.meetingId === selectedMeetingId ? "active" : ""}`}
                  key={meeting.meetingId}
                  onClick={() => setSelectedMeetingId(meeting.meetingId)}
                >
                  <strong>{meeting.title || meeting.meetingId}</strong>
                  <span>
                    {platformLabel(meeting.platform)} - {formatStatus(meeting.status)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{meetingTitle}</h1>
            <p>
              {meetingPlatform}
              {participantCount ? ` - ${participantCount} participant${participantCount === 1 ? "" : "s"}` : ""}
              {duration ? ` - ${formatDuration(duration)} elapsed` : ""}
            </p>
          </div>
          <div className={`livePill ${isLive ? "live" : ""}`}>
            <span />
            {formatStatus(meetingStatus)}
          </div>
        </header>

        <div className="board">
          <section className="meetingColumn">
            <div className="joinBlock">
              <span className="panelLabel">Start a new meeting</span>
              <form className="joinForm" onSubmit={handleStartMeeting}>
                <input
                  aria-label="Meeting link"
                  value={meetingUrl}
                  onChange={(event) => setMeetingUrl(event.target.value)}
                  placeholder="https://meet.google.com/..."
                />
                <button disabled={isStarting || !meetingUrl} className="joinButton">
                  <Icon name="bot" />
                  {isStarting ? "Joining" : "Join"}
                </button>
              </form>
            </div>

            {(error || success) && (
              <div className={`toast ${error ? "error" : "success"}`}>{error || success}</div>
            )}

            <section className="transcriptPanel">
              <span className="panelLabel">Live Transcript</span>
              <div className="transcriptViewport">
                {transcriptSegments.length === 0 ? (
                  <div className="emptyTranscript">
                    <strong>No transcript yet</strong>
                    <span>Audio chunks will appear here as the bot captures the meeting.</span>
                  </div>
                ) : (
                  transcriptSegments.map((segment, index) => (
                    <article className="transcriptTurn" key={`${segment.chunkId}-${segment.startTime}-${index}`}>
                      <strong className={`speakerTag speaker${index % 3}`}>
                        {speakerKey(segment.speaker)}
                        {segment.speaker ? ` (${segment.speaker})` : ""}
                      </strong>
                      <p>{segment.text}</p>
                      <time>{Number(segment.endTime || 0).toLocaleString(undefined, { minimumIntegerDigits: 2 })}s</time>
                    </article>
                  ))
                )}
              </div>
              <button
                className="processButton"
                disabled={!selectedMeeting || isProcessing || transcriptSegments.length === 0}
                onClick={handleProcessMeeting}
                aria-label="Process meeting"
              >
                <Icon name={isProcessing ? "settings" : "down"} />
              </button>
            </section>
          </section>

          <aside className="insightColumn">
            <section className="statsPanel">
              <span className="panelLabel">Session Stats</span>
              <div className="statGrid">
                <div className="statTile">
                  <span>Tickets</span>
                  <strong>{ticketCount}</strong>
                </div>
                <div className="statTile">
                  <span>Speakers</span>
                  <strong>{speakers.length}</strong>
                </div>
                <div className="statTile">
                  <span>Duration</span>
                  <strong>{formatDuration(duration)}</strong>
                </div>
                <div className="statTile">
                  <span>Chunks</span>
                  <strong>{chunkCount}</strong>
                </div>
              </div>
            </section>

            <section className="speakerPanel">
              <span className="panelLabel">Speaker Mapping</span>
              <div className="speakerRows">
                {speakers.length === 0 ? (
                  <div className="mutedLine">No speakers detected.</div>
                ) : (
                  speakers.slice(0, 5).map((speaker, index) => (
                    <div className="speakerRow" key={`${speaker.speakerId}-${index}`}>
                      <span>{speakerKey(speaker.speakerId)}</span>
                      <Icon name="arrow" />
                      <strong>{speaker.displayName || speaker.speakerId}</strong>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="ticketsPanel">
              <span className="panelLabel">Generated Tickets</span>
              <div className="ticketList">
                {tickets.length === 0 ? (
                  <div className="ticketCard empty">
                    <strong>No tickets generated</strong>
                    <p>Process a transcript to create tickets from the call.</p>
                  </div>
                ) : (
                  tickets.map((ticket, index) => (
                    <article className="ticketCard" key={`${ticket.title}-${index}`}>
                      <strong>{ticket.title}</strong>
                      <p>{ticket.description}</p>
                      <div>
                        <span className={`ticketStatus ${ticket.priority}`}>{ticket.priority || "open"}</span>
                        <span className="assignee">
                          <Icon name="user" />
                          {ticket.assignee || "Unassigned"}
                        </span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            {actionItems.length > 0 ? (
              <section className="actionsPanel">
                <span className="panelLabel">Action Items</span>
                <ul>
                  {actionItems.slice(0, 4).map((item, index) => (
                    <li key={`${item.text}-${index}`}>{item.text}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}

export default App;
