import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: MongoMemoryServer | undefined;

/** Levanta un mongod efímero para pruebas de integración de repositorios y HTTP. */
export async function startMongo(): Promise<void> {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
}

export async function clearMongo(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function stopMongo(): Promise<void> {
  await mongoose.disconnect();
  await server?.stop();
}
