import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseline, policySchema, propose } from '../src/lib/engine/policy.ts';
import { execute } from '../src/lib/engine/simulator.ts';
import { verify, canPromote, enumerateScenarios, checkInvariants } from '../src/lib/engine/verifier.ts';
const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
const first = baseline(ids[0]);
const second = propose(first, ids[1], ['at_most_one_charge']);
const third = propose(second, ids[2], ['at_most_one_charge']);

test('ambiguous committed timeout creates a real duplicate on blind retry', () => {
  const result = execute(first, { id: 'witness', faults: ['timeout_after','ok','ok'], reconciliation: 'fresh' });
  assert.equal(result.charges, 2);
  assert.ok(checkInvariants(result).includes('at_most_one_charge'));
  assert.equal(result.trace[0].response, 'timeout');
  assert.equal(result.trace[0].ledgerCharges, 1);
});
test('reconciliation repairs fresh reads but stale reads reject the first mutation', () => {
  const scenario = { id: 'witness', faults: ['timeout_after','ok','ok'] as const };
  assert.equal(execute(second, { ...scenario, faults: [...scenario.faults], reconciliation: 'fresh' }).charges, 1);
  assert.equal(execute(second, { ...scenario, faults: [...scenario.faults], reconciliation: 'stale' }).charges, 2);
});
test('complete bounded search rejects two candidates and verifies stable idempotency', () => {
  assert.equal(enumerateScenarios().length, 54);
  const a = verify(first), b = verify(second), c = verify(third);
  assert.equal(a.verdict, 'rejected'); assert.equal(b.verdict, 'rejected');
  assert.ok(a.counterexamples.length > b.counterexamples.length);
  assert.equal(c.verdict, 'passed'); assert.equal(c.explored, 54);
  assert.ok(canPromote(c)); assert.ok(!canPromote(a)); assert.ok(!canPromote({ ...c, explored: 53 }));
  for (const witness of b.counterexamples) assert.deepEqual(execute(second, witness.scenario), witness.execution);
  assert.deepEqual(verify(third), c);
});
test('all pre-commit timeouts escalate without pretending payment succeeded', () => {
  const r = execute(third, { id: 'unreachable', faults: ['timeout_before','timeout_before','timeout_before'], reconciliation: 'stale' });
  assert.equal(r.outcome, 'escalated'); assert.equal(r.charges, 0); assert.equal(r.steps, 6);
});
test('schema rejects executable fields and out-of-bound retries', () => {
  assert.equal(policySchema.safeParse({ ...third, code: 'process.exit()' }).success, false);
  assert.equal(policySchema.safeParse({ ...third, maxRetries: 3 }).success, false);
  assert.throws(() => propose(first, ids[1], ['unrelated']));
});
test('verifier catches false success independently of generator', () => {
  assert.ok(checkInvariants({ outcome: 'succeeded', charges: 0, steps: 1, attempts: 1, trace: [] }).includes('success_requires_exactly_one_charge'));
});

import { policyKey } from '../src/lib/engine/policy.ts';
import { buildPrompt, createProposer, validateCandidate } from '../src/lib/engine/proposer.ts';
const candidate = { analysis: 'Committed timeout retried without a key.', name: 'Keyed retry', maxRetries: 2, reconcileBeforeRetry: false, idempotency: 'stable', rationale: 'A stable key deduplicates.' };
test('liveness invariant rejects a policy that never retries', () => {
  const lazy = policySchema.parse({ ...third, id: ids[1], maxRetries: 0 });
  const r = verify(lazy);
  assert.equal(r.verdict, 'rejected'); assert.equal(r.explored, 54);
  assert.ok(r.counterexamples.some(c => c.violations.includes('recovers_when_provider_available')));
  // Liveness does not change the existing lineage: 20 + 10 + 0 counterexamples, as before.
  assert.equal(verify(first).counterexamples.length, 20); assert.equal(verify(second).counterexamples.length, 10);
});
test('model output is schema-validated and duplicates are refused', () => {
  assert.equal(validateCandidate(candidate, new Set()).ok, true);
  const dup = validateCandidate(candidate, new Set([policyKey(candidate as never)]));
  assert.equal(dup.ok, false); assert.equal(!dup.ok && dup.reason, 'duplicate');
  for (const bad of [{ ...candidate, code: 'process.exit()' }, { ...candidate, maxRetries: 5 }, { ...candidate, idempotency: 'random' }, 'not json'])
    assert.equal(validateCandidate(bad, new Set()).ok, false);
});
test('prompt carries real counterexamples, history and rejection feedback', () => {
  const evidence = verify(first).counterexamples;
  const prompt = JSON.parse(buildPrompt({ generation: 2, attempt: 2, currentPolicy: first, counterexamples: evidence,
    history: [{ version: 1, config: policyKey(first), name: first.name, origin: 'seed', verdict: 'rejected', counterexampleCount: 15, violationCounts: { at_most_one_charge: 15 } }],
    rejected: [{ generation: 2, attempt: 1, reason: 'duplicate', detail: 'Configuration already tried' }] }));
  assert.ok(prompt.counterexamples.length >= 1 && prompt.counterexamples.every((c: { scenario: string }) => evidence.some(e => e.scenario.id === c.scenario)));
  assert.equal(prompt.rejectedProposals[0].reason, 'duplicate');
  assert.deepEqual(prompt.configurationsAlreadyTried, [policyKey(first)]);
});
test('no provider without a key; fallback mutation skips tried configurations', () => {
  assert.equal(createProposer({}), null);
  assert.throws(() => propose(second, ids[2], ['at_most_one_charge'], new Set([policyKey(third)])));
  const oneRetry = policySchema.parse({ ...second, maxRetries: 1 });
  const next = propose(oneRetry, ids[2], ['at_most_one_charge', 'recovers_when_provider_available'], new Set([policyKey({ ...oneRetry, idempotency: 'stable' })]));
  assert.equal(policyKey(next), policyKey({ ...oneRetry, maxRetries: 2 }));
});
