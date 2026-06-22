import { access } from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { createAudioStreamer } from "./audioStreamer.js";
import { backendClient } from "./backendClient.js";
import { env } from "./env.js";
import { platformStrategies } from "./platforms.js";

const browsers = { chromium, firefox, webkit };
const activeMeetings = new Map();
let loginSession = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveStorageState() {
  if (!env.PLAYWRIGHT_STORAGE_STATE_PATH) {
    return undefined;
  }

  const resolvedPath = path.resolve(env.PLAYWRIGHT_STORAGE_STATE_PATH);
  await access(resolvedPath);
  return resolvedPath;
}

async function createBrowserSession() {
  const browserType = browsers[env.PLAYWRIGHT_BROWSER];
  const launchArgs = {
    headless: env.PLAYWRIGHT_HEADLESS,
    args: [
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-features=DialMediaRouteProvider"
    ]
  };

  if (env.PLAYWRIGHT_BROWSER === "chromium") {
    const context = await chromium.launchPersistentContext(path.resolve(env.PLAYWRIGHT_USER_DATA_DIR), {
      ...launchArgs,
      permissions: ["microphone", "camera"]
    });
    return {
      browser: context.browser(),
      context,
      page: context.pages()[0] || (await context.newPage())
    };
  }

  const browser = await browserType.launch(launchArgs);
  const context = await browser.newContext({
    permissions: ["microphone", "camera"],
    storageState: await resolveStorageState().catch(() => undefined)
  });
  return { browser, context, page: await context.newPage() };
}

export async function openLoginSession(loginUrl = "https://accounts.google.com") {
  if (loginSession) {
    await loginSession.page.goto(loginUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    return {
      ok: true,
      alreadyOpen: true,
      url: loginSession.page.url()
    };
  }

  const session = await createBrowserSession();
  loginSession = session;
  await session.page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  return {
    ok: true,
    alreadyOpen: false,
    url: session.page.url()
  };
}

export async function closeLoginSession() {
  if (!loginSession) {
    return { ok: true, closed: false };
  }

  const session = loginSession;
  loginSession = null;
  await session.context.close().catch(() => {});
  await session.browser?.close().catch(() => {});
  return { ok: true, closed: true };
}

async function waitForMeetingEnd(page) {
  while (!page.isClosed()) {
    const ended = await page
      .getByText(/you left the meeting|meeting has ended|call ended|thanks for attending/i)
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);

    if (ended) {
      return "Meeting ended";
    }

    await sleep(2000);
  }

  return "Browser session closed";
}

async function attemptJoin(job, session, strategy) {
  await backendClient.sendStatus({
    meetingId: job.meetingId,
    joinStatus: "joining",
    message: `Opening ${job.platform}`
  });

  await strategy.prepare(session.page);

  let waitingMessage = null;
  for (let attempt = 0; attempt <= env.BOT_JOIN_RETRY_COUNT; attempt += 1) {
    const result = await strategy.join(session.page, job.meetingUrl, job.botDisplayName, {
      timeoutMs: env.BOT_DEFAULT_TIMEOUT_MS,
      approvalWaitMs: env.BOT_APPROVAL_WAIT_MS
    });

    if (result.state === "joined") {
      return result;
    }

    waitingMessage = result.message;
    await backendClient.sendStatus({
      meetingId: job.meetingId,
      joinStatus: "joining",
      message: result.message
    });

    if (attempt < env.BOT_JOIN_RETRY_COUNT) {
      await session.page.reload({ waitUntil: "domcontentloaded", timeout: env.BOT_DEFAULT_TIMEOUT_MS }).catch(
        () => {}
      );
      await sleep(2000);
    }
  }

  throw new Error(waitingMessage || "Bot stayed in waiting room without being admitted");
}

export async function joinMeeting(job) {
  if (activeMeetings.has(job.meetingId)) {
    throw new Error(`Meeting ${job.meetingId} is already running`);
  }

  const strategy = platformStrategies[job.platform];
  if (!strategy) {
    throw new Error(`No bot strategy for platform ${job.platform}`);
  }

  const session = await createBrowserSession();
  activeMeetings.set(job.meetingId, session);
  let preserveOpenSession = false;
  let streamer = null;

  const forwardAudioChunk = (chunk) =>
    backendClient.sendAudioChunk({
      meetingId: job.meetingId,
      language: job.language,
      ...chunk
    });

  async function stopStreamer() {
    if (!streamer) {
      return;
    }

    const activeStreamer = streamer;
    streamer = null;
    await activeStreamer.stop().catch((error) => {
      console.error(`[bot-service] failed to stop ${activeStreamer.type || "audio"} streamer`, error);
    });
  }

  async function holdBrowserOpen(label) {
    preserveOpenSession = true;
    console.log(`[bot-service] debug hold open: ${label} for meeting ${job.meetingId}`);
    await session.page.waitForEvent("close").catch(() => {});
  }

  try {
    streamer = await createAudioStreamer({
      page: session.page,
      meetingId: job.meetingId,
      onChunk: forwardAudioChunk,
      phase: "beforeJoin"
    });

    const result = await attemptJoin(job, session, strategy);

    await backendClient.sendStatus({
      meetingId: job.meetingId,
      joinStatus: "joined",
      message: result.message || "Bot joined meeting"
    });

    await sleep(env.BOT_POST_JOIN_WAIT_MS);

    if (!streamer) {
      streamer = await createAudioStreamer({
        page: session.page,
        meetingId: job.meetingId,
        onChunk: forwardAudioChunk,
        phase: "afterJoin"
      });
    }

    if (env.BOT_KEEP_BROWSER_OPEN_AFTER_JOIN) {
      console.log(`[bot-service] keeping browser open after join for meeting ${job.meetingId}`);
      if (env.BOT_DISABLE_AUTOCLOSE) {
        await holdBrowserOpen("joined");
        await stopStreamer();
        await backendClient.sendStatus({
          meetingId: job.meetingId,
          joinStatus: "left",
          message: "Browser session closed manually after join"
        }).catch(() => {});
        return;
      }
    }

    const endReason = await waitForMeetingEnd(session.page);
    await stopStreamer();

    await backendClient.sendStatus({
      meetingId: job.meetingId,
      joinStatus: "left",
      message: endReason
    });
  } catch (error) {
    const pageTitle = await session.page.title().catch(() => "unknown-title");
    const pageUrl = session.page.url?.() || "unknown-url";
    const message = error instanceof Error ? error.message : String(error);

    await backendClient.sendStatus({
      meetingId: job.meetingId,
      joinStatus: "failed",
      message: `${message} | page=${pageTitle} | url=${pageUrl}`
    });
    console.error("[bot-service] join failure context", {
      meetingId: job.meetingId,
      pageTitle,
      pageUrl,
      message
    });
    if (env.BOT_DISABLE_AUTOCLOSE) {
      await holdBrowserOpen("failed");
      return;
    }
    await sleep(env.BOT_KEEP_BROWSER_OPEN_ON_FAILURE_MS);
    throw error;
  } finally {
    await stopStreamer();
    if (!preserveOpenSession) {
      activeMeetings.delete(job.meetingId);
      await session.context.close().catch(() => {});
      await session.browser?.close().catch(() => {});
    } else {
      activeMeetings.delete(job.meetingId);
    }
  }
}
