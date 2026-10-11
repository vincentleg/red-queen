import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import { baseline, propose, type PaymentPolicy } from './policy.ts';
import { verify, canPromote, BOUNDS, MODEL } from './verifier.ts';
import { engineEventSchema, type EngineEvent, type EventInput } from './events.ts';

export async function evolve(db: Db, runId: string, publish: (events: EngineEvent[]) => void) {
  let sequence = 0;
  const collection = (name: string) => db.collection<Document & { _id: string }>(name);
  const emit = async (inputs: EventInput[]) => {
    const events = inputs.map(input => engineEventSchema.parse({ ...input, schemaVersion: 1,
      eventId: randomUUID(), experimentId: runId, sequence: sequence++, occurredAt: new Date().toISOString() }));
    if (events.length) {
      await collection('events').insertMany(events.map(e => ({ ...e, _id: e.eventId })));
      publish(events);
    }
    return events;
  };
  try {
    await emit([{ type: 'run.started', payload: { generator: 'deterministic', model: MODEL } }]);
    let policy: PaymentPolicy = baseline(randomUUID());
    let parent: PaymentPolicy | null = null;
    for (let generation = 0; generation < 3; generation++) {
      await collection('policies').insertOne({ _id: policy.id, runId, policy, parentPolicyId: parent?.id ?? null, status: 'proposed', generator: 'deterministic' });
      if (parent) await collection('lineage').insertOne({ _id: randomUUID(), runId, parentPolicyId: parent.id, policyId: policy.id, relation: 'mutation' });
      await emit([{ type: 'policy.proposed', payload: { policy, parentPolicyId: parent?.id ?? null,
        rationale: !parent ? 'Baseline retries ambiguous failures without deduplication.' : generation === 1
          ? 'Observed duplicate charge: reconcile before retry.' : 'Stale reconciliation still duplicated a charge: preserve the same idempotency key across retries.' } },
      { type: 'verification.started', payload: { policyId: policy.id, bounds: BOUNDS } }]);
      const result = verify(policy);
      const executionEvents: EventInput[] = [];
      for (const { scenario, execution } of result.executions) {
        executionEvents.push({ type: 'execution.started', payload: { policyId: policy.id, scenarioId: scenario.id } });
        for (const step of execution.trace) if (step.fault && step.fault !== 'ok')
          executionEvents.push({ type: 'fault.injected', payload: { policyId: policy.id, scenarioId: scenario.id, step: step.step, kind: step.fault } });
        executionEvents.push({ type: 'execution.completed', payload: { policyId: policy.id, scenarioId: scenario.id, outcome: execution.outcome, charges: execution.charges, steps: execution.steps } });
      }
      const counterexamples = result.counterexamples.map(example => ({ _id: randomUUID(), runId, policyId: policy.id, ...example }));
      if (counterexamples.length) await collection('counterexamples').insertMany(counterexamples);
      // Batch writes preserve real execution order; no artificial timing or fabricated telemetry.
      for (let i = 0; i < executionEvents.length; i += 60) await emit(executionEvents.slice(i, i + 60));
      await emit(counterexamples.map(c => ({ type: 'verification.counterexample', payload: {
        policyId: policy.id, counterexampleId: c._id, scenarioId: c.scenario.id, violations: c.violations, charges: c.execution.charges } })));
      const [verification] = await emit([{ type: 'verification.completed', payload: { policyId: policy.id,
        verdict: result.verdict, exploredScenarios: result.explored, counterexamples: counterexamples.length, bounds: BOUNDS } }]);
      await collection('policies').updateOne({ _id: policy.id }, { $set: { status: result.verdict, verificationEventId: verification.eventId, bounds: BOUNDS,
        explored: result.explored, counterexampleCount: counterexamples.length, sampleCounterexample: counterexamples[0] ?? null } });
      if (canPromote(result)) {
        // Rejected candidates never enter this branch. All evidence is durable before promotion.
        if (!parent) throw new Error('Expected baseline counterexample');
        await collection('policies').updateOne({ _id: policy.id, status: 'passed' }, { $set: { status: 'promoted' } });
        await emit([{ type: 'policy.promoted', payload: { policyId: policy.id, previousPolicyId: parent.id, verificationEventId: verification.eventId } }]);
        await collection('runs').updateOne({ _id: runId }, { $set: { status: 'completed', promotedPolicyId: policy.id, completedAt: new Date(), bounds: BOUNDS } });
        await emit([{ type: 'run.completed', payload: { promotedPolicyId: policy.id, persisted: true } }]);
        return;
      }
      parent = policy;
      policy = propose(parent, randomUUID(), [...new Set(result.counterexamples.flatMap(c => c.violations))]);
    }
    throw new Error('Bounded search exhausted');
  } catch {
    await collection('runs').updateOne({ _id: runId }, { $set: { status: 'failed', failedAt: new Date() } }).catch(() => undefined);
    try { await emit([{ type: 'run.failed', payload: { category: 'storage_or_engine_failure' } }]); }
    catch { publish([engineEventSchema.parse({ type: 'run.failed', payload: { category: 'storage_or_engine_failure' },
      schemaVersion: 1, eventId: randomUUID(), experimentId: runId, sequence: sequence++, occurredAt: new Date().toISOString() })]); }
  }
}
