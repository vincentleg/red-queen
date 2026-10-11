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
        engine: "unavailable",
        latencyMs: Math.round(performance.now() - started),
        checkedAt: new Date().toISOString(),
      },
      { headers },
    );
  } catch {
    // Never serialize driver errors: they can contain hosts or credentials.
    return NextResponse.json(
      { status: "unavailable", database: "unavailable", engine: "unavailable", checkedAt: new Date().toISOString() },
      { status: 503, headers },
    );
  }
}
