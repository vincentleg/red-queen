import "server-only";
import { MongoClient, type Db } from "mongodb";
import { z } from "zod";

const environmentSchema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  MONGODB_DB: z.string().min(1).default("red_queen"),
});

const connection = globalThis as typeof globalThis & {
  redQueenMongo?: Promise<MongoClient>;
};

export async function getDatabase(): Promise<Db> {
  const config = environmentSchema.safeParse(process.env);
  if (!config.success) throw new Error("Database configuration unavailable");

  if (!connection.redQueenMongo) {
    const client = new MongoClient(config.data.MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 5000,
    });
    connection.redQueenMongo = client.connect().catch(async () => {
      connection.redQueenMongo = undefined;
      await client.close().catch(() => undefined);
      throw new Error("Database connection unavailable");
    });
  }

  return (await connection.redQueenMongo).db(config.data.MONGODB_DB);
}
