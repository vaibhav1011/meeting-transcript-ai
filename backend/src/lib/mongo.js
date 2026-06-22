import mongoose from "mongoose";

let connected = false;

export async function connectMongo(uri) {
  if (connected) {
    return mongoose.connection;
  }

  await mongoose.connect(uri);
  connected = true;
  return mongoose.connection;
}
