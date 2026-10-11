import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { evolve } from '../src/lib/engine/run.ts';
import { execute } from '../src/lib/engine/simulator.ts';
let client;
try {
  client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'red_queen');
  const runId = randomUUID();
  await db.collection('runs').insertOne({ _id: runId, status: 'running', generator: 'deterministic', startedAt: new Date(), source: 'integration-check' });
  const emitted = [];
  await evolve(db, runId, events => emitted.push(...events));
  const [run, policies, counterexamples, events, lineage] = await Promise.all([
    db.collection('runs').findOne({ _id: runId }),
    db.collection('policies').find({ runId }).sort({ 'policy.version': 1 }).toArray(),
    db.collection('counterexamples').find({ runId }).toArray(),
    db.collection('events').find({ experimentId: runId }).sort({ sequence: 1 }).toArray(),
    db.collection('lineage').find({ runId }).toArray(),
  ]);
  assert.equal(run.status, 'completed');
  assert.deepEqual(policies.map(p => p.status), ['rejected', 'rejected', 'promoted']);
  assert.equal(lineage.length, 2);
  assert.equal(events.length, emitted.length);
  assert.equal(events.filter(e => e.type === 'execution.completed').length, 162);
  assert.equal(events.filter(e => e.type === 'policy.promoted').length, 1);
  assert.ok(counterexamples.length > 0);
  for (const witness of counterexamples) {
    const policy = policies.find(p => p._id === witness.policyId).policy;
    assert.deepEqual(execute(policy, witness.scenario), witness.execution);
  }
  console.log(JSON.stringify({ status: 'PASS', runId, policies: policies.length, counterexamples: counterexamples.length, events: events.length, lineage: lineage.length, scenariosExecuted: 162, persistedReadback: true, counterexampleReplay: true }));
} catch (error) {
  const category = error?.name === 'AssertionError' ? 'persistence_or_engine_assertion' : error?.code === 18 ? 'authentication' : 'database_or_engine_unavailable';
  console.error(JSON.stringify({ status: 'FAIL', category }));
  process.exitCode = 1;
} finally { await client?.close(); }
