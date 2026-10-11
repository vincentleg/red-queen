import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { baseline, propose } from '../src/lib/engine/policy.ts';
import { verify } from '../src/lib/engine/verifier.ts';
import { engineEventSchema, type EventInput } from '../src/lib/engine/events.ts';
import { demoSnapshot, demoChapters, eventsThroughChapter } from '../src/lib/demo.ts';

function actualRun(retries = 2) {
  const runId = randomUUID();
  const first = { ...baseline(randomUUID()), maxRetries: retries };
  const second = propose(first, randomUUID(), ['at_most_one_charge']);
  // Use the real full-bound idempotent policy for the final verified candidate.
  const third = { ...propose(second, randomUUID(), ['at_most_one_charge']), maxRetries: 2 };
  const policies = [first, second, third];
  const events: ReturnType<typeof engineEventSchema.parse>[] = [];
  const emit = (event: EventInput) => events.push(engineEventSchema.parse({ ...event, schemaVersion: 1,
    eventId: randomUUID(), experimentId: runId, sequence: events.length, occurredAt: new Date().toISOString() }));
  const counterexamples = [];
  emit({ type: 'run.started', payload: { generator: 'deterministic', model: 'payment-v1' } });
  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i];
    const result = verify(policy);
    emit({ type: 'policy.proposed', payload: { policy, parentPolicyId: policies[i - 1]?.id ?? null, origin: i ? 'deterministic_fallback' : 'seed', rationale: 'Real verifier fixture.' } });
    for (const x of result.executions) emit({ type: 'execution.completed', payload: { policyId: policy.id, scenarioId: x.scenario.id, outcome: x.execution.outcome, charges: x.execution.charges, steps: x.execution.steps } });
    counterexamples.push(...result.counterexamples.map(c => ({ ...c, policyId: policy.id })));
    emit({ type: 'verification.completed', payload: { policyId: policy.id, verdict: result.verdict, exploredScenarios: result.explored, counterexamples: result.counterexamples.length, bounds: result.bounds } });
  }
  emit({ type: 'policy.promoted', payload: { policyId: third.id, previousPolicyId: second.id, verificationEventId: events.at(-1)!.eventId } });
  emit({ type: 'run.completed', payload: { promotedPolicyId: third.id, persisted: true } });
  return { run: { _id: runId, status: 'completed', mode: 'deterministic', promotedPolicyId: third.id }, events, counterexamples,
    lineage: [{ parentPolicyId: first.id, policyId: second.id }, { parentPolicyId: second.id, policyId: third.id }] };
}
test('demo chapters use real verifier results and stay within presentation timing', () => {
  const data = demoSnapshot(actualRun());
  const chapters = demoChapters(data);
  assert.equal(chapters.length, 8);
  assert.deepEqual([chapters[1].metric, chapters[3].metric, chapters[4].metric], ['20', '10', '54 / 54']);
  assert.equal(data.scenarios, 162);
  assert.equal(data.witness.execution.charges, 2);
  assert.equal(chapters.reduce((n, c) => n + c.duration, 0), 103000);
  assert.ok(!eventsThroughChapter(data, 1).some(e => e.type === 'policy.promoted'));
  assert.equal(eventsThroughChapter(data, 5).at(-1)?.type, 'policy.promoted');
});
test('different measured baseline results are narrated without hardcoded failure counts', () => {
  const data = demoSnapshot(actualRun(1));
  assert.notEqual(data.generations[0].verification.counterexamples, 20);
  assert.equal(demoChapters(data)[1].metric, String(data.generations[0].verification.counterexamples));
});
test('demo refuses incomplete evidence instead of inventing a successful chapter', () => {
  const input = actualRun();
  assert.throws(() => demoSnapshot({ ...input, events: input.events.filter(e => e.type !== 'policy.promoted') }));
  assert.throws(() => demoSnapshot({ ...input, counterexamples: [] }));
  assert.throws(() => demoSnapshot({ run: null }));
});
