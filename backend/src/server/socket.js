import { Server } from "socket.io";
import { env } from "./env.js";

let io;

export function attachSocket(server) {
  io = new Server(server, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    socket.on("meeting.subscribe", ({ meetingId }) => {
      if (meetingId) {
        socket.join(`meeting:${meetingId}`);
      }
    });
  });
}

export function getIo() {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
}
