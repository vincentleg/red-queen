import { test } from 'node:test';
import assert from 'node:assert/strict';
import { milestones } from '../src/lib/engine/playback.ts';
import { engineEventSchema, type EventInput } from '../src/lib/engine/events.ts';
const id = '00000000-0000-4000-8000-000000000001';
test('playback preserves original chronology and folds repeated faults without inventing events', () => {
  const inputs: EventInput[] = [
    { type: 'run.started', payload: { generator: 'deterministic', model: 'payment-v1' } },
    { type: 'fault.injected', payload: { policyId: id, scenarioId: 'a', step: 0, kind: 'timeout_after' } },
    { type: 'fault.injected', payload: { policyId: id, scenarioId: 'b', step: 0, kind: 'timeout_after' } },
    { type: 'verification.counterexample', payload: { policyId: id, counterexampleId: id, scenarioId: 'a', violations: ['at_most_one_charge'], charges: 2 } },
    { type: 'run.completed', payload: { promotedPolicyId: id, persisted: true } },
  ];
  const events = inputs.map((e, sequence) => engineEventSchema.parse({ ...e, schemaVersion: 1, eventId: id, experimentId: id, sequence, occurredAt: '2026-10-11T00:00:00.000Z' }));
  const steps = milestones(events);
  assert.deepEqual(steps.map(s => s.end), [1, 2, 4, 5]);
  assert.ok(steps.every(s => s.event === events[s.end - 1]));
  assert.equal(steps.at(-1)?.label, 'EVOLUTION COMPLETE');
  assert.equal(events.length, 5);
  assert.deepEqual(milestones([]), []);
});
