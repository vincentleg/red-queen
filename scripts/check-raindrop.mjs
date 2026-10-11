// Delivers an actual existing Atlas run. Observes real HTTP acknowledgements; never mocks transport.
import { MongoClient } from 'mongodb';
import { writeFile } from 'node:fs/promises';
const originalFetch = globalThis.fetch;
const receipts = [];
let dbClient;
try {
  if (!process.env.RAINDROP_WRITE_KEY?.trim()) throw new Error('missing_write_key');
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'api.raindrop.ai' && init?.method?.toLowerCase() === 'post') {
      const sent = JSON.parse(init.body);
      receipts.push({ endpoint: url.pathname, httpStatus: response.status,
        eventIds: Array.isArray(sent) ? sent.map(e => e.eventId).filter(Boolean) : [sent.eventId].filter(Boolean) });
    }
    return response;
  };
  const { deliverRaindropRun } = await import('../src/lib/telemetry/raindrop.ts');
  dbClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const db = dbClient.db(process.env.MONGODB_DB || 'red_queen');
  const run = await db.collection('runs').findOne({ status: 'completed', source: { $ne: 'integration-check-test-double' } }, { sort: { startedAt: -1 } });
  if (!run) throw new Error('no_persisted_run');
  const result = await deliverRaindropRun(db, run._id);
  const accepted = receipts.filter(r => r.httpStatus >= 200 && r.httpStatus < 300 && r.endpoint.includes('events'));
  if (result.status !== 'attempted' || !accepted.length || !accepted.some(r => r.eventIds.length)) throw new Error('delivery_not_acknowledged');
  const receipt = { status: 'PASS', runId: run._id, events: result.events, receipts };
  await writeFile('/private/tmp/red-queen-raindrop-receipt.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: 'PASS', runId: run._id, events: result.events,
    receipts: receipts.map(r => ({ endpoint: r.endpoint, httpStatus: r.httpStatus, count: r.eventIds.length })),
    sampleEventId: accepted[0].eventIds[0], verification: 'Raindrop ingestion HTTP acknowledgement; not dashboard readback' }));
} catch {
  console.error('Raindrop delivery: BLOCKED (missing configuration, Atlas unavailable, or no ingestion acknowledgement)');
  process.exitCode = 1;
} finally { globalThis.fetch = originalFetch; await dbClient?.close(); }
