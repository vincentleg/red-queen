import 'server-only';
import type { Db } from 'mongodb';
import { engineEventSchema } from '../engine/events.ts';
import { raindropEventTypes, toRaindropEvents } from './raindrop-events.ts';

// Called by Next.js after() once the evolution response has finished. Atlas remains authoritative.
// SDK close() drains its buffers with a bounded shutdown deadline; it is not a receipt guarantee.
export async function deliverRaindropRun(db: Db, runId: string) {
  if (!process.env.RAINDROP_WRITE_KEY?.trim()) return { status: 'disabled' as const, events: 0 };
  let client: import('raindrop-ai').Raindrop | undefined;
  try {
    const docs = await db.collection('events').find({ experimentId: runId, type: { $in: raindropEventTypes } })
      .sort({ sequence: 1 }).limit(500).toArray();
    const recorded = docs.map(({ _id, ...event }) => engineEventSchema.parse(event));
    const batch = toRaindropEvents(recorded);
    if (!batch.events.length) return { status: 'empty' as const, events: 0 };
    const { Raindrop } = await import('raindrop-ai');
    client = new Raindrop({ writeKey: process.env.RAINDROP_WRITE_KEY.trim(), debugLogs: false,
      useExternalOtel: true, appGit: false, localWorkshopUrl: false, bufferSize: 500, bufferTimeout: 60000 });
    client.trackAi(batch.events);
    client.trackSignal(batch.signals);
    await client.close();
    client = undefined;
    return { status: 'attempted' as const, events: batch.events.length };
  } catch {
    // Never log SDK errors, request bodies, credentials, or database connection details.
    return { status: 'failed' as const, events: 0 };
  } finally { await client?.close().catch(() => undefined); }
}
