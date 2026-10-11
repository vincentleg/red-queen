// One real model request, then reuse that exact response in one persisted evolution.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { baseline, policyKey, policySchema } from '../src/lib/engine/policy.ts';
import { verify, canPromote } from '../src/lib/engine/verifier.ts';
import { createProposer, validateCandidate, ProposerError } from '../src/lib/engine/proposer.ts';
import { evolve } from '../src/lib/engine/run.ts';

let client;
try {
  assert.ok(process.env.GEMINI_API_KEY, 'missing_replacement_key');
  const proposer = createProposer({ GEMINI_API_KEY: process.env.GEMINI_API_KEY });
  const seed = baseline(randomUUID());
  const initial = verify(seed);
  const violationCounts = {};
  for (const c of initial.counterexamples) for (const v of c.violations) violationCounts[v] = (violationCounts[v] || 0) + 1;
  const response = await proposer.propose({ generation: 2, attempt: 1, currentPolicy: seed,
    counterexamples: initial.counterexamples, rejected: [], history: [{ version: 1, config: policyKey(seed),
      name: seed.name, origin: 'seed', verdict: initial.verdict, counterexampleCount: initial.counterexamples.length, violationCounts }] });
  assert.equal(response.stopReason, 'end_turn', 'incomplete_model_response');
  const validated = validateCandidate(response.output, new Set([policyKey(seed)]));
  assert.ok(validated.ok, 'invalid_or_duplicate_candidate');
  const { analysis, rationale, ...genes } = validated.candidate;
  const checked = verify(policySchema.parse({ ...genes, id: randomUUID(), version: 2, onExhaustion: 'escalate' }));
  assert.equal(checked.explored, 54);
  client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'red_queen');
  const runId = randomUUID();
  await db.collection('runs').insertOne({ _id: runId, status: 'running', generator: 'ai', provider: proposer.provider,
    model: proposer.model, startedAt: new Date(), source: 'live-gemini-check' });
  let consumed = false;
  await evolve(db, runId, () => {}, { ...proposer, async propose(context) {
    if (consumed) throw new ProposerError('model_error', 'Single-call check budget exhausted');
    assert.equal(policyKey(context.currentPolicy), policyKey(seed));
    consumed = true;
    return response;
  } });
  const [run, policy, proposal] = await Promise.all([
    db.collection('runs').findOne({ _id: runId }),
    db.collection('policies').findOne({ runId, origin: 'ai' }),
    db.collection('proposals').findOne({ runId, status: 'accepted_for_verification' }),
  ]);
  assert.ok(policy && proposal, 'ai_persistence_missing');
  assert.deepEqual(proposal.output, response.output);
  assert.equal(policy.explored, 54);
  const event = await db.collection('events').findOne({ eventId: policy.verificationEventId });
  assert.equal(event.payload.verdict, checked.verdict);
  assert.equal(event.payload.exploredScenarios, 54);
  assert.equal(run.status, 'completed');
  console.log(JSON.stringify({ aiMode: 'PASS', model: proposer.model, runId, atlasPersistence: 'PASS',
    scenarios: 54, aiVerdict: checked.verdict, aiPromoted: canPromote(checked) && policy.status === 'promoted' }));
} catch (error) {
  const category = error instanceof ProposerError ? `${error.category}: ${error.detail}`
    : error?.name === 'AssertionError' ? `validation: ${error.message.split('\n')[0]}` : 'atlas_or_configuration_unavailable';
  console.error(JSON.stringify({ aiMode: 'BLOCKED', category }));
  process.exitCode = 1;
} finally { await client?.close(); }
