function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function detectPlatform(meetingUrl) {
  const url = meetingUrl.toLowerCase();
  if (url.includes("meet.google.com")) return "google_meet";
  if (url.includes("zoom.us")) return "zoom";
  if (url.includes("teams.microsoft.com") || url.includes("teams.live.com")) return "microsoft_teams";
  throw new Error("Unsupported meeting URL");
}

export const platformStrategies = {
  google_meet: {
    async prepare(page) {
      await page.goto("https://meet.google.com", { waitUntil: "domcontentloaded" }).catch(() => {});
    },
    async join(page, meetingUrl, displayName, options) {
      await gotoMeeting(page, meetingUrl, options.timeoutMs);
      await clearInterstitials(page, [/got it/i, /dismiss/i, /continue without microphone and camera/i]);
      await dismissPreJoinMedia(page);
      if (
        await pageHasAnyText(page, [/people/i, /meeting details/i, /leave call/i, /chat with everyone/i])
      ) {
        return { state: "joined", message: "Already in Google Meet" };
      }
      await fillNameIfNeeded(page, displayName, [
        'input[aria-label*="your name" i]',
        'input[placeholder*="your name" i]',
        'input[type="text"]'
      ]);
      const joinedIndicators = [/people/i, /meeting details/i, /leave call/i, /chat with everyone/i];
      await clickVisibleButton(
        page,
        [/join now/i, /ask to join/i, /request access/i, /^join$/i, /continue/i],
        options.timeoutMs,
        joinedIndicators
      ).catch(async (error) => {
        if (await pageHasAnyText(page, joinedIndicators)) {
          return true;
        }
        throw error;
      });

      const result = await waitForJoinOutcome(page, {
        joinedIndicators,
        waitingIndicators: [/asking to join/i, /someone in the call should let you in/i, /waiting for/i],
        deniedIndicators: [/you can't join this call/i, /removed from the meeting/i],
        timeoutMs: options.approvalWaitMs
      });

      return result.state === "waiting"
        ? { state: "waiting", message: "Waiting for host approval in Google Meet" }
        : { state: "joined", message: "Joined Google Meet" };
    }
  },
  zoom: {
    async prepare(page) {
      await page.goto("https://app.zoom.us/wc", { waitUntil: "domcontentloaded" }).catch(() => {});
    },
    async join(page, meetingUrl, displayName, options) {
      await gotoMeeting(page, meetingUrl, options.timeoutMs);
      await clickVisibleButton(page, [/join from your browser/i, /join meeting/i], 6000).catch(() => {});
      await fillNameIfNeeded(page, displayName, [
        'input[aria-label*="name" i]',
        'input[placeholder*="name" i]',
        'input[type="text"]'
      ]);
      await clickVisibleButton(page, [/join/i, /join audio by computer/i], options.timeoutMs).catch(() => {});
      await clickVisibleButton(page, [/join audio by computer/i, /computer audio/i], 4000).catch(() => {});

      const result = await waitForJoinOutcome(page, {
        joinedIndicators: [/participants/i, /mute/i, /leave/i, /chat/i],
        waitingIndicators: [/waiting for the host/i, /host has another meeting in progress/i],
        deniedIndicators: [/meeting has been ended/i, /authorized attendees only/i],
        timeoutMs: options.approvalWaitMs
      });

      return result.state === "waiting"
        ? { state: "waiting", message: "Waiting for host to start or admit Zoom participant" }
        : { state: "joined", message: "Joined Zoom meeting" };
    }
  },
  microsoft_teams: {
    async prepare(page) {
      await page.goto("https://teams.microsoft.com", { waitUntil: "domcontentloaded" }).catch(() => {});
    },
    async join(page, meetingUrl, displayName, options) {
      await gotoMeeting(page, meetingUrl, options.timeoutMs);
      await preferBrowserJoinForTeams(page);
      await clickVisibleButton(page, [/continue on this browser/i, /join on the web instead/i], 8000).catch(
        () => {}
      );
      await preferBrowserJoinForTeams(page);
      await clickVisibleButton(page, [/continue on this browser/i, /join on the web instead/i], 4000).catch(
        () => {}
      );
      await clearInterstitials(page, [/got it/i, /close/i]);
      await fillNameIfNeeded(page, displayName, [
        'input[placeholder*="name" i]',
        'input[aria-label*="name" i]',
        'input[data-tid*="prejoin-display-name-input"]',
        'input[type="text"]'
      ]);
      await dismissPreJoinMedia(page);
      await clickVisibleButton(page, [/join now/i], options.timeoutMs);

      const result = await waitForJoinOutcome(page, {
        joinedIndicators: [/people/i, /chat/i, /leave/i, /meeting options/i],
        waitingIndicators: [/we've let people in the meeting know you're waiting/i, /someone will let you in soon/i],
        deniedIndicators: [/you can't join this meeting/i, /the organizer has denied/i],
        timeoutMs: options.approvalWaitMs
      });

      return result.state === "waiting"
        ? { state: "waiting", message: "Waiting in Teams lobby" }
        : { state: "joined", message: "Joined Microsoft Teams meeting" };
    }
  }
};

async function gotoMeeting(page, meetingUrl, timeoutMs) {
  await page.goto(meetingUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await sleep(1500);
}

async function preferBrowserJoinForTeams(page) {
  await page.bringToFront().catch(() => {});

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Enter").catch(() => {});
    await sleep(150);
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(250);
  }
}

async function waitForJoinOutcome(page, options) {
  const startedAt = Date.now();
  let sawWaitingState = false;

  while (Date.now() - startedAt < options.timeoutMs) {
    if (page.isClosed()) {
      throw new Error("Meeting page closed during join flow");
    }

    if (await pageHasAnyText(page, options.deniedIndicators)) {
      throw new Error("Meeting join was denied by the platform or host");
    }

    if (await pageHasAnyText(page, options.joinedIndicators)) {
      return { state: "joined" };
    }

    if (await pageHasAnyText(page, options.waitingIndicators)) {
      sawWaitingState = true;
    }

    await sleep(1500);
  }

  if (sawWaitingState) {
    return { state: "waiting" };
  }

  throw new Error("Timed out waiting for meeting join confirmation");
}

async function pageHasAnyText(page, patterns) {
  for (const pattern of patterns) {
    const locator = page.getByText(pattern, { exact: false }).first();
    if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function clickVisibleButton(page, patterns, timeoutMs, successPatterns = []) {
  const startedAt = Date.now();
  let visibleButtons = [];

  while (Date.now() - startedAt < timeoutMs) {
    if (successPatterns.length && (await pageHasAnyText(page, successPatterns))) {
      return true;
    }

    for (const pattern of patterns) {
      const roleButton = page.getByRole("button", { name: pattern }).first();
      if (await roleButton.isVisible({ timeout: 500 }).catch(() => false)) {
        await roleButton.click().catch(async () => {
          await roleButton.click({ force: true });
        });
        return true;
      }

      const textButton = page
        .locator('button, [role="button"], a, div[jsname], span[jsname]')
        .filter({ hasText: pattern })
        .first();
      if (await textButton.isVisible({ timeout: 250 }).catch(() => false)) {
        await textButton.click().catch(async () => {
          await textButton.click({ force: true });
        });
        return true;
      }
    }

    visibleButtons = await getVisibleButtonLabels(page).catch(() => visibleButtons);
    await sleep(1000);
  }

  const available = visibleButtons.length ? ` Visible buttons: ${visibleButtons.join(" | ")}` : "";
  throw new Error(`Unable to find button for patterns: ${patterns.map(String).join(", ")}.${available}`);
}

async function getVisibleButtonLabels(page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return candidates
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => {
        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.textContent ||
          "";
        return label.replace(/\s+/g, " ").trim();
      })
      .filter(Boolean)
      .slice(0, 12);
  });
}

async function clearInterstitials(page, patterns) {
  for (const pattern of patterns) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await button.click().catch(() => {});
      await sleep(300);
    }
  }
}

async function fillNameIfNeeded(page, displayName, selectors) {
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 1200 }).catch(() => false)) {
      await input.fill(displayName).catch(() => {});
      return true;
    }
  }
  return false;
}

async function dismissPreJoinMedia(page) {
  const patterns = [
    /turn off microphone/i,
    /mute/i,
    /turn off camera/i,
    /camera off/i,
    /toggle microphone/i,
    /toggle camera/i
  ];

  for (const pattern of patterns) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {});
      await sleep(200);
    }
  }
}
