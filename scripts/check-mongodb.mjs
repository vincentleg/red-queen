import { MongoClient } from "mongodb";

let client;
try {
  if (!process.env.MONGODB_URI) throw new Error("Missing configuration");
  client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 5000,
  });
  await client.connect();
  await client.db(process.env.MONGODB_DB || "red_queen").command({ ping: 1 }, { timeoutMS: 5000 });
  console.log("MongoDB connection: PASS (authenticated ping; no data written)");
} catch (error) {
  const kind = error?.name === "MongoServerError" && error?.code === 18
    ? "authentication failed"
    : "configuration, network, or Atlas access unavailable";
  console.error(`MongoDB connection: FAIL (${kind}; connection details redacted)`);
  process.exitCode = 1;
} finally {
  await client?.close();
}
