import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const EnvSchema = z.object({
  BOT_PORT: z.coerce.number().default(8090),
  BACKEND_BASE_URL: z.string().url(),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .default("false")
    .transform((value) => value !== "false"),
  PLAYWRIGHT_BROWSER: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
  PLAYWRIGHT_USER_DATA_DIR: z.string().default(path.resolve("./playwright-profile")),
  PLAYWRIGHT_STORAGE_STATE_PATH: z.string().default(""),
  BOT_AUDIO_CAPTURE_MODE: z.enum(["auto", "browser", "ffmpeg", "off"]).default("browser"),
  BOT_AUDIO_CAPTURE_COMMAND: z.string().default(""),
  BOT_AUDIO_CHUNK_SECONDS: z.coerce.number().default(8),
  BOT_AUDIO_TEST_DURATION_SECONDS: z.coerce.number().default(10),
  BOT_DEFAULT_TIMEOUT_MS: z.coerce.number().default(30000),
  BOT_POST_JOIN_WAIT_MS: z.coerce.number().default(15000),
  BOT_APPROVAL_WAIT_MS: z.coerce.number().default(180000),
  BOT_JOIN_RETRY_COUNT: z.coerce.number().default(2),
  BOT_KEEP_BROWSER_OPEN_ON_FAILURE_MS: z.coerce.number().default(20000),
  BOT_KEEP_BROWSER_OPEN_AFTER_JOIN: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  BOT_DISABLE_AUTOCLOSE: z
    .string()
    .default("true")
    .transform((value) => value === "true")
});

export const env = EnvSchema.parse(process.env);
