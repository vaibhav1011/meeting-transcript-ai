import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { meetingsRouter } from "./routes/meetings.js";
import { env } from "./env.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: "25mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/", meetingsRouter);

  app.use((error, _request, response, _next) => {
    console.error("[backend] request failed", error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error"
    });
  });

  return app;
}
