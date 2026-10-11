import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRaindropEvents } from '../src/lib/telemetry/raindrop-events.ts';
import { engineEventSchema, type EventInput } from '../src/lib/engine/events.ts';
import { baseline } from '../src/lib/engine/policy.ts';
import { BOUNDS } from '../src/lib/engine/verifier.ts';
const id = '00000000-0000-4000-8000-000000000001';
const policy = baseline(id);
const make = (input: EventInput, sequence: number) => engineEventSchema.parse({ ...input, schemaVersion: 1, eventId: `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`, experimentId: id, sequence, occurredAt: '2026-10-11T00:00:00.000Z' });
test('Raindrop export correlates actual policy failures without calling fallback AI', () => {
 const data = toRaindropEvents([
  make({ type: 'policy.proposed', payload: { policy, parentPolicyId: null, origin: 'seed', rationale: 'Baseline' } }, 0),
  make({ type: 'verification.counterexample', payload: { policyId: id, counterexampleId: id, scenarioId: 'stale:timeout_after,ok,ok', violations: ['at_most_one_charge'], charges: 2 } }, 1),
  make({ type: 'verification.completed', payload: { policyId: id, verdict: 'rejected', exploredScenarios: 54, counterexamples: 20, bounds: BOUNDS } }, 2),
 ]);
 assert.equal(data.events.length, 4);
 assert.equal(data.events.at(-1)?.event, 'red_queen.policy.rejected');
 assert.equal(data.events.at(-1)?.properties?.generation, 1);
 assert.equal(data.events.at(-1)?.properties?.exploredScenarios, 54);
 assert.ok(data.events.every(e => !e.model && e.convoId === id));
 assert.equal(data.signals[0].sentiment, 'NEGATIVE');
 assert.equal(data.signals[0].eventId, data.events[0].eventId);
});
test('execution noise is excluded and no events are invented for empty history', () => {
 assert.deepEqual(toRaindropEvents([]), { events: [], signals: [] });
 assert.equal(toRaindropEvents([make({ type: 'execution.started', payload: { policyId: id, scenarioId: 'a' } }, 0)]).events.length, 0);
});
