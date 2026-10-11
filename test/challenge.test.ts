import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challenge, challengeRequestSchema, attacks, type AttackName } from '../src/lib/engine/challenge.ts';
import { baseline, propose } from '../src/lib/engine/policy.ts';
const seed = baseline('00000000-0000-4000-8000-000000000001');
const reconciled = propose(seed, '00000000-0000-4000-8000-000000000002', ['at_most_one_charge']);
const stable = propose(reconciled, '00000000-0000-4000-8000-000000000003', ['at_most_one_charge']);
test('same stale-ledger attack breaks baseline and reconciliation, but stable keys survive', () => {
  const results = [seed, reconciled, stable].map(p => challenge(p, 'stale_reconciliation'));
  assert.deepEqual(results.map(r => r.execution.charges), [2, 2, 1]);
  assert.deepEqual(results.map(r => r.verdict), ['violated', 'violated', 'survived']);
  assert.equal(results[1].execution.trace.find(t => t.action === 'reconcile')?.response, 'not_found');
  assert.ok(results[0].violations.includes('at_most_one_charge'));
  assert.deepEqual(results[0].scenario, results[2].scenario);
});
test('manual patterns execute within bounds and before-processing timeouts never invent ledger charges', () => {
  for (const attack of Object.keys(attacks) as AttackName[]) {
    const r = challenge(stable, attack);
    assert.equal(r.verdict, 'survived');
    assert.ok(r.execution.steps <= 6);
  }
  const before = challenge(seed, 'before_processing');
  assert.deepEqual(before.execution.trace.filter(t => t.action === 'charge').map(t => t.ledgerCharges), [0, 0, 1]);
});
test('challenge API input rejects arbitrary policies and unbounded attacks', () => {
  const request = { runId: seed.id, policyIds: [seed.id], attack: 'stale_reconciliation' };
  assert.equal(challengeRequestSchema.safeParse(request).success, true);
  assert.equal(challengeRequestSchema.safeParse({ ...request, policy: stable }).success, false);
  assert.equal(challengeRequestSchema.safeParse({ ...request, attack: 'arbitrary' }).success, false);
  assert.equal(challengeRequestSchema.safeParse({ ...request, policyIds: Array(3).fill(seed.id) }).success, false);
});
