const RECORDER_BINDING_NAME = "__meetingAssistantAudioEvent";

const BROWSER_AUDIO_CAPTURE_SCRIPT = `
(() => {
  if (window.__meetingAssistantAudioCaptureInstalled) {
    return;
  }
  window.__meetingAssistantAudioCaptureInstalled = true;

  const state = {
    peerConnections: new Set(),
    sources: new Map(),
    recorder: null,
    audioContext: null,
    destination: null,
    chunkMs: Number(window.__meetingAssistantAudioCaptureOptions?.chunkMs) || 8000,
    stopped: false
  };

  function send(type, payload = {}) {
    const bridge = window.${RECORDER_BINDING_NAME};
    if (typeof bridge === "function") {
      bridge({ type, payload }).catch(() => {});
    }
  }

  function pickMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4"
    ];

    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) {
      return "";
    }

    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = () => reject(reader.error || new Error("Failed to read audio blob"));
      reader.readAsDataURL(blob);
    });
  }

  function ensureAudioGraph() {
    if (state.audioContext && state.destination) {
      return true;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      send("error", { message: "AudioContext is not available in this browser" });
      return false;
    }

    state.audioContext = new AudioContextCtor();
    state.destination = state.audioContext.createMediaStreamDestination();
    state.audioContext.resume?.().catch(() => {});
    return true;
  }

  function liveSourceCount() {
    let count = 0;
    for (const track of state.sources.keys()) {
      if (track.readyState === "live") {
        count += 1;
      }
    }
    return count;
  }

  function stopRecorderIfIdle() {
    if (liveSourceCount() > 0) {
      return;
    }

    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.stop();
    }
  }

  function ensureRecorder() {
    if (state.stopped || !state.destination) {
      return;
    }

    if (state.recorder && state.recorder.state !== "inactive") {
      return;
    }

    if (liveSourceCount() === 0) {
      return;
    }

    if (!window.MediaRecorder) {
      send("error", { message: "MediaRecorder is not available in this browser" });
      return;
    }

    const mimeType = pickMimeType();
    const options = mimeType ? { mimeType } : undefined;
    const recorder = new MediaRecorder(state.destination.stream, options);
    state.recorder = recorder;

    recorder.addEventListener("dataavailable", async (event) => {
      if (!event.data || event.data.size === 0 || state.stopped) {
        return;
      }

      try {
        const audioBase64 = await blobToBase64(event.data);
        send("chunk", {
          audioBase64,
          mimeType: event.data.type || recorder.mimeType || mimeType || "audio/webm",
          bytes: event.data.size,
          sampleRate: state.audioContext?.sampleRate || 48000
        });
      } catch (error) {
        send("error", { message: error instanceof Error ? error.message : String(error) });
      }
    });

    recorder.addEventListener("error", (event) => {
      send("error", { message: event.error?.message || "Browser audio recorder failed" });
    });

    recorder.addEventListener("stop", () => {
      send("status", { message: "Browser audio recorder stopped" });
    });

    recorder.start(state.chunkMs);
    send("status", {
      message: "Browser audio recorder started",
      mimeType: recorder.mimeType || mimeType || "audio/webm",
      trackCount: liveSourceCount(),
      sampleRate: state.audioContext?.sampleRate || 48000
    });
  }

  function addRemoteTrack(track) {
    if (!track || track.kind !== "audio" || state.sources.has(track) || state.stopped) {
      return;
    }

    if (!ensureAudioGraph()) {
      return;
    }

    try {
      const source = state.audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(state.destination);
      state.sources.set(track, source);
      state.audioContext.resume?.().catch(() => {});
      send("status", {
        message: "Remote audio track attached",
        trackCount: liveSourceCount(),
        sampleRate: state.audioContext.sampleRate
      });

      track.addEventListener(
        "ended",
        () => {
          const savedSource = state.sources.get(track);
          savedSource?.disconnect();
          state.sources.delete(track);
          stopRecorderIfIdle();
        },
        { once: true }
      );

      ensureRecorder();
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  function attachStream(stream) {
    if (!stream) {
      return;
    }

    for (const track of stream.getAudioTracks()) {
      addRemoteTrack(track);
    }

    stream.addEventListener?.("addtrack", (event) => addRemoteTrack(event.track));
  }

  function scanPeerConnection(peerConnection) {
    try {
      for (const receiver of peerConnection.getReceivers?.() || []) {
        addRemoteTrack(receiver.track);
      }
    } catch (_error) {
      // Some platforms replace or close PeerConnections aggressively during pre-join.
    }
  }

  function trackPeerConnection(peerConnection) {
    if (!peerConnection || state.peerConnections.has(peerConnection)) {
      return peerConnection;
    }

    state.peerConnections.add(peerConnection);
    peerConnection.addEventListener("track", (event) => {
      addRemoteTrack(event.track);
      for (const stream of event.streams || []) {
        attachStream(stream);
      }
    });

    const originalSetRemoteDescription = peerConnection.setRemoteDescription?.bind(peerConnection);
    if (originalSetRemoteDescription) {
      peerConnection.setRemoteDescription = async (...args) => {
        const result = await originalSetRemoteDescription(...args);
        scanPeerConnection(peerConnection);
        return result;
      };
    }

    scanPeerConnection(peerConnection);
    return peerConnection;
  }

  function wrapPeerConnectionConstructor(name) {
    const Original = window[name];
    if (!Original || Original.__meetingAssistantWrapped) {
      return;
    }

    function WrappedPeerConnection(...args) {
      return trackPeerConnection(new Original(...args));
    }

    Object.setPrototypeOf(WrappedPeerConnection, Original);
    WrappedPeerConnection.prototype = Original.prototype;
    WrappedPeerConnection.__meetingAssistantWrapped = true;
    window[name] = WrappedPeerConnection;
  }

  wrapPeerConnectionConstructor("RTCPeerConnection");
  wrapPeerConnectionConstructor("webkitRTCPeerConnection");

  window.__meetingAssistantConfigureAudioCapture = (options = {}) => {
    const chunkMs = Number(options.chunkMs);
    if (Number.isFinite(chunkMs) && chunkMs >= 1000) {
      state.chunkMs = chunkMs;
    }
  };

  window.__meetingAssistantStopAudioCapture = () => {
    state.stopped = true;
    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.stop();
    }

    for (const source of state.sources.values()) {
      source.disconnect();
    }
    state.sources.clear();
    state.audioContext?.close?.().catch(() => {});
  };

  setInterval(() => {
    for (const peerConnection of state.peerConnections) {
      scanPeerConnection(peerConnection);
    }
    ensureRecorder();
  }, 1000);

  send("status", { message: "Browser audio capture bridge installed" });
})();
`;

async function browserSupportsCapture(page) {
  return page
    .evaluate(() => Boolean(window.MediaRecorder && window.RTCPeerConnection && (window.AudioContext || window.webkitAudioContext)))
    .catch(() => false);
}

export async function createBrowserChunkStreamer({ page, meetingId, chunkSeconds, onChunk }) {
  if (!(await browserSupportsCapture(page))) {
    throw new Error("Browser does not expose MediaRecorder, RTCPeerConnection, or AudioContext");
  }

  let sequence = 0;
  const pendingSends = new Set();

  await page.exposeBinding(RECORDER_BINDING_NAME, async (_source, event) => {
    if (!event || typeof event !== "object") {
      return;
    }

    if (event.type === "status") {
      console.log(`[bot-service] audio capture ${meetingId}: ${event.payload?.message || "status"}`, event.payload || {});
      return;
    }

    if (event.type === "error") {
      console.error(`[bot-service] audio capture ${meetingId}: ${event.payload?.message || "unknown error"}`);
      return;
    }

    if (event.type !== "chunk" || !event.payload?.audioBase64) {
      return;
    }

    const currentSequence = sequence;
    sequence += 1;

    const sendPromise = onChunk({
      chunkId: `${meetingId}-${String(currentSequence).padStart(5, "0")}`,
      sequence: currentSequence,
      audioBase64: event.payload.audioBase64,
      mimeType: event.payload.mimeType || "audio/webm",
      sampleRate: event.payload.sampleRate || 48000
    }).catch((error) => {
      console.error(
        `[bot-service] failed to forward browser audio chunk ${currentSequence} for ${meetingId}`,
        error
      );
    });

    pendingSends.add(sendPromise);
    sendPromise.finally(() => pendingSends.delete(sendPromise));
  });

  await page.addInitScript({
    content: `
      window.__meetingAssistantAudioCaptureOptions = { chunkMs: ${JSON.stringify(chunkSeconds * 1000)} };
      ${BROWSER_AUDIO_CAPTURE_SCRIPT}
    `
  });

  return {
    type: "browser",
    async stop() {
      await page.evaluate(() => window.__meetingAssistantStopAudioCapture?.()).catch(() => {});
      await Promise.allSettled([...pendingSends]);
    }
  };
}
