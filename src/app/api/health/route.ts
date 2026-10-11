import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  const headers = { "Cache-Control": "no-store" };
  try {
    const db = await getDatabase();
    await db.command({ ping: 1 }, { timeoutMS: 5000 });
    return NextResponse.json(
      {
        status: "ok",
        database: "connected",
        engine: "ready",
        latencyMs: Math.round(performance.now() - started),
        checkedAt: new Date().toISOString(),
      },
      { headers },
    );
  } catch (error) {
    // Never serialize driver errors: they can contain hosts or credentials.
    return NextResponse.json(
      { status: "unavailable", database: "unavailable", engine: "unavailable", category: safeCategory(error), checkedAt: new Date().toISOString() },
      { status: 503, headers },
    );
  }
}

// Inspect only known error codes; never serialize messages, hosts, or causes.
function safeCategory(error: unknown): string {
  const queue: unknown[] = [error];
  let selectionTimeout = false;
  for (let i = 0; i < queue.length && i < 30; i++) {
    const value = queue[i];
    if (!value || typeof value !== "object") continue;
    const item = value as { code?: unknown; name?: unknown; cause?: unknown; reason?: unknown; error?: unknown; servers?: unknown };
    if (item.code === "CONFIGURATION") return "configuration";
    if (item.code === 18) return "authentication";
    if (item.code === 13) return "authorization";
    if (item.code === "ENOTFOUND" || item.code === "EAI_AGAIN") return "dns";
    if (typeof item.code === "string" && (item.code.startsWith("ERR_SSL_") || item.code.startsWith("ERR_TLS_"))) return "tls_or_network_access";
    if (item.name === "MongoServerSelectionError") selectionTimeout = true;
    queue.push(item.cause, item.reason, item.error);
    if (item.servers instanceof Map) queue.push(...item.servers.values());
  }
  return selectionTimeout ? "server_selection_timeout" : "connection_unavailable";
}
