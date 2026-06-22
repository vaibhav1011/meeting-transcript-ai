import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8080),
  MONGODB_URI: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),
  BOT_SERVICE_URL: z.string().url(),
  ML_SERVICE_URL: z.string().url(),
  LLM_BASE_URL: z.string().url().default("http://host.docker.internal:11434/v1"),
  LLM_API_KEY: z.string().default("not-needed"),
  LLM_MODEL: z.string().default("llama3"),
  DEFAULT_LANGUAGE: z.string().default("en"),
  BOT_DISPLAY_NAME: z.string().default("Meeting Assistant")
});

export const env = EnvSchema.parse(process.env);
