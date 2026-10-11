import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { evolve } from '@/lib/engine/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  try {
    const db = await getDatabase();
    const runId = randomUUID();
    const locks = db.collection<{ _id: string; expiresAt: Date; runId: string }>('engine_locks');
    // One global demo run at a time, with crash recovery. No unbounded paid work.
    try {
      await locks.updateOne({ _id: 'chamber', expiresAt: { $lte: new Date() } },
        { $set: { runId, expiresAt: new Date(Date.now() + 90000) } }, { upsert: true });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 11000)
        return NextResponse.json({ error: 'Chamber busy. Retry after the current run finishes.' }, { status: 409 });
      throw error;
    }
    try {
      await db.collection<{ _id: string; [key: string]: unknown }>('runs').insertOne({ _id: runId,
        status: 'running', generator: 'deterministic', startedAt: new Date() });
    } catch {
      await locks.deleteOne({ _id: 'chamber', runId });
      throw new Error('Storage unavailable');
    }
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          await evolve(db, runId, events => {
            if (connected) controller.enqueue(encoder.encode(events.map(e => JSON.stringify(e)).join('\n') + '\n'));
          });
        } finally {
          await locks.deleteOne({ _id: 'chamber', runId }).catch(() => undefined);
          if (connected) controller.close();
        }
      },
      cancel() { connected = false; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  } catch {
    return NextResponse.json({ error: 'Atlas persistence unavailable. No evolution started.' }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get('runId');
  if (runId && !/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
  try {
    const db = await getDatabase();
    const runs = db.collection<{ _id: string; [key: string]: unknown }>('runs');
    const run = runId ? await runs.findOne({ _id: runId }) : await runs.findOne({}, { sort: { startedAt: -1 } });
    if (!run) return NextResponse.json({ run: null }, { headers: { 'Cache-Control': 'no-store' } });
    const [policies, counterexamples, events, lineage] = await Promise.all([
      db.collection('policies').find({ runId: run._id }).sort({ 'policy.version': 1 }).toArray(),
      db.collection('counterexamples').find({ runId: run._id }).toArray(),
      db.collection('events').find({ experimentId: run._id }).sort({ sequence: 1 }).toArray(),
      db.collection('lineage').find({ runId: run._id }).toArray(),
    ]);
    return NextResponse.json({ run, policies, counterexamples, events: events.map(({ _id, ...event }) => event), lineage }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Atlas history unavailable' }, { status: 503 }); }
}
