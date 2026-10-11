import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { evolve } from '../src/lib/engine/run.ts';
import { execute } from '../src/lib/engine/simulator.ts';
import { createProposer } from '../src/lib/engine/proposer.ts';
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
  // AI branch with a TEST DOUBLE (never used in production): attempt 1 repeats the parent (must be refused as a
  // duplicate), attempt 2 must receive that rejection as feedback and derive a change from the real evidence.
  const seen = [];
  const double = { provider: 'test-double', model: 'scripted', async propose(ctx) {
    seen.push(ctx);
    const p = ctx.currentPolicy;
    if (ctx.attempt === 1) return { stopReason: 'end_turn', output: { analysis: 'Repeat parent.', name: 'Repeat', maxRetries: p.maxRetries, reconcileBeforeRetry: p.reconcileBeforeRetry, idempotency: p.idempotency, rationale: 'Probe duplicate guard.' } };
    assert.equal(ctx.rejected.at(-1).reason, 'duplicate');
    assert.ok(ctx.counterexamples.some(c => c.violations.includes('at_most_one_charge')));
    return { stopReason: 'end_turn', output: { analysis: `Observed ${ctx.history.at(-1).violationCounts.at_most_one_charge} duplicate charges.`, name: 'Keyed retry', maxRetries: 2, reconcileBeforeRetry: false, idempotency: 'stable', rationale: 'Durable key deduplicates committed timeouts.' } };
  } };
  const aiRunId = randomUUID();
  await db.collection('runs').insertOne({ _id: aiRunId, status: 'running', generator: 'ai', startedAt: new Date(), source: 'integration-check-test-double' });
  const aiEvents = [];
  await evolve(db, aiRunId, events => aiEvents.push(...events), double);
  const [aiRun, aiPolicies, proposals] = await Promise.all([db.collection('runs').findOne({ _id: aiRunId }),
    db.collection('policies').find({ runId: aiRunId }).sort({ 'policy.version': 1 }).toArray(),
    db.collection('proposals').find({ runId: aiRunId }).sort({ attempt: 1 }).toArray()]);
  assert.equal(aiRun.status, 'completed'); assert.equal(aiRun.mode, 'ai');
  assert.deepEqual(aiPolicies.map(p => [p.origin, p.status]), [['seed', 'rejected'], ['ai', 'promoted']]);
  assert.deepEqual(proposals.map(p => p.status), ['rejected', 'accepted_for_verification']);
  assert.equal(aiEvents.filter(e => e.type === 'proposal.rejected').length, 1);
  assert.equal(seen.length, 2);

  let live = 'skipped: ANTHROPIC_API_KEY not set';
  const proposer = createProposer();
  if (proposer) {
    const liveRunId = randomUUID();
    await db.collection('runs').insertOne({ _id: liveRunId, status: 'running', generator: 'ai', startedAt: new Date(), source: 'integration-check-live-model' });
    const liveEvents = [];
    await evolve(db, liveRunId, events => liveEvents.push(...events), proposer);
    const liveProposals = await db.collection('proposals').find({ runId: liveRunId }).toArray();
    live = { runId: liveRunId, model: proposer.model, status: (await db.collection('runs').findOne({ _id: liveRunId })).status,
      proposals: liveProposals.map(p => `${p.generation}.${p.attempt}:${p.status}${p.reason ? '/' + p.reason : ''}`),
      origins: liveEvents.filter(e => e.type === 'policy.proposed').map(e => e.payload.origin) };
  }
  console.log(JSON.stringify({ aiBranch: 'PASS', aiRunId, liveModel: live }));
  console.log(JSON.stringify({ status: 'PASS', runId, policies: policies.length, counterexamples: counterexamples.length, events: events.length, lineage: lineage.length, scenariosExecuted: 162, persistedReadback: true, counterexampleReplay: true }));
} catch (error) {
  const category = error?.name === 'AssertionError' ? 'persistence_or_engine_assertion' : error?.code === 18 ? 'authentication' : 'database_or_engine_unavailable';
  console.error(JSON.stringify({ status: 'FAIL', category }));
  process.exitCode = 1;
} finally { await client?.close(); }
