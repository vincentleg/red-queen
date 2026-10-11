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
