import { createServer } from "node:http";
import { connectMongo } from "./lib/mongo.js";
import { createApp } from "./server/app.js";
import { env } from "./server/env.js";
import { attachSocket } from "./server/socket.js";

async function main() {
  await connectMongo(env.MONGODB_URI);

  const app = createApp();
  const server = createServer(app);
  attachSocket(server);

  server.listen(env.PORT, () => {
    console.log(`[backend] listening on :${env.PORT}`);
  });
}

main().catch((error) => {
  console.error("[backend] fatal", error);
  process.exit(1);
});
