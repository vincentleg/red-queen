import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { evolve } from '@/lib/engine/run';
import { createProposer } from '@/lib/engine/proposer';
import { deliverRaindropRun } from '@/lib/telemetry/raindrop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// AI mode: up to 6 bounded model calls (25s each) inside a 110s budget, then verification.
export const maxDuration = 180;

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  try {
    const db = await getDatabase();
    const runId = randomUUID();
    const proposer = createProposer();
    const locks = db.collection<{ _id: string; expiresAt: Date; runId: string }>('engine_locks');
    // One global demo run at a time, with crash recovery. No unbounded paid work.
    try {
      await locks.updateOne({ _id: 'chamber', expiresAt: { $lte: new Date() } },
        { $set: { runId, expiresAt: new Date(Date.now() + 200000) } }, { upsert: true });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 11000)
        return NextResponse.json({ error: 'Chamber busy. Retry after the current run finishes.' }, { status: 409 });
      throw error;
    }
    try {
      await db.collection<{ _id: string; [key: string]: unknown }>('runs').insertOne({ _id: runId,
        status: 'running', generator: proposer ? 'ai' : 'deterministic', mode: proposer ? 'ai' : 'deterministic',
        provider: proposer?.provider ?? null, model: proposer?.model ?? null, startedAt: new Date() });
    } catch {
      await locks.deleteOne({ _id: 'chamber', runId });
      throw new Error('Storage unavailable');
    }
    let evolutionFinished!: () => void;
    const finished = new Promise<void>(resolve => { evolutionFinished = resolve; });
    // after() keeps serverless delivery alive after the response, including disconnected clients.
    // Wait for the engine even if the client disconnects before the run has finished.
    if (process.env.RAINDROP_WRITE_KEY?.trim()) after(async () => {
      await finished;
      await deliverRaindropRun(db, runId);
    });
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          await evolve(db, runId, events => {
            if (connected) controller.enqueue(encoder.encode(events.map(e => JSON.stringify(e)).join('\n') + '\n'));
          }, proposer);
        } finally {
          evolutionFinished();
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
  const params = new URL(request.url).searchParams;
  const runId = params.get('runId');
  if (runId && !/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 });
  try {
    const db = await getDatabase();
    const runs = db.collection<{ _id: string; [key: string]: unknown }>('runs');
    const run = runId ? await runs.findOne({ _id: runId }) : await runs.findOne({ source: { $ne: 'integration-check-test-double' },
      ...(params.get('demo') === '1' ? { status: 'completed', mode: 'deterministic', generations: 3 } : {}) }, { sort: { startedAt: -1 } });
    if (!run) return NextResponse.json({ run: null }, { headers: { 'Cache-Control': 'no-store' } });
    const [policies, counterexamples, events, lineage, proposals] = await Promise.all([
      db.collection('policies').find({ runId: run._id }).sort({ 'policy.version': 1 }).toArray(),
      db.collection('counterexamples').find({ runId: run._id }).toArray(),
      db.collection('events').find({ experimentId: run._id }).sort({ sequence: 1 }).toArray(),
      db.collection('lineage').find({ runId: run._id }).toArray(),
      db.collection('proposals').find({ runId: run._id }).sort({ generation: 1, attempt: 1 }).toArray(),
    ]);
    return NextResponse.json({ run, policies, counterexamples, events: events.map(({ _id, ...event }) => event), lineage, proposals }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Atlas history unavailable' }, { status: 503 }); }
}
