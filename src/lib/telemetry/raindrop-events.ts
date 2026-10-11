import type { AiTrackEvent, SignalEvent } from 'raindrop-ai';
import type { EngineEvent } from '../engine/events.ts';
import { BOUNDS } from '../engine/verifier.ts';

export const raindropEventTypes = ['run.started', 'policy.proposed', 'verification.counterexample',
  'verification.completed', 'policy.promoted', 'proposal.rejected', 'run.completed', 'run.failed'];

// Only recorded engine data is exported. Deterministic candidates never acquire an AI model label.
export function toRaindropEvents(events: EngineEvent[]) {
  const policies = new Map<string, { generation: number; origin: string; model?: string; eventId: string }>();
  const tracked: AiTrackEvent[] = [];
  const signals: SignalEvent[] = [];
  for (const e of events) {
    if (e.type === 'policy.proposed') policies.set(e.payload.policy.id, { generation: e.payload.policy.version,
      origin: e.payload.origin ?? 'seed', model: e.payload.origin === 'ai' ? e.payload.llmModel : undefined, eventId: e.eventId });
    if (!raindropEventTypes.includes(e.type)) continue;
    const policyId = e.type === 'policy.proposed' ? e.payload.policy.id : 'policyId' in e.payload ? e.payload.policyId
      : 'promotedPolicyId' in e.payload ? e.payload.promotedPolicyId : undefined;
    const policy = policyId ? policies.get(policyId) : undefined;
    const generation = policy?.generation ?? ('generation' in e.payload ? e.payload.generation : undefined);
    const verdict = e.type === 'verification.completed' ? e.payload.verdict : e.type === 'verification.counterexample' ? 'violated'
      : e.type === 'policy.promoted' ? 'promoted' : e.type === 'proposal.rejected' ? 'rejected' : undefined;
    const properties = { application: 'red-queen', runId: e.experimentId, atlasEventId: e.eventId, sequence: e.sequence,
      occurredAt: e.occurredAt, environment: 'simulated_payment', verificationScope: 'bounded',
      scenarioCount: BOUNDS.scenarioCount, maxAttempts: BOUNDS.maxAttempts, maxSteps: BOUNDS.maxSteps,
      ...(policyId ? { policyId } : {}), ...(generation !== undefined ? { generation } : {}),
      ...(policy ? { origin: policy.origin } : {}), ...(verdict ? { verdict } : {}),
      ...(e.type === 'run.started' ? { generator: e.payload.generator } : {}),
      ...(e.type === 'verification.completed' ? { exploredScenarios: e.payload.exploredScenarios, counterexamples: e.payload.counterexamples } : {}),
      ...(e.type === 'verification.counterexample' ? { scenarioId: e.payload.scenarioId, charges: e.payload.charges, violationCount: e.payload.violations.length } : {}),
    };
    const item: AiTrackEvent = { eventId: e.eventId, event: `red_queen.${e.type}`, userId: 'red-queen-engine',
      convoId: e.experimentId, output: JSON.stringify(e.payload), properties, ...(policy?.model ? { model: policy.model } : {}) };
    tracked.push(item);
    if (e.type === 'verification.completed') {
      if (e.payload.verdict === 'rejected') tracked.push({ ...item, eventId: `${e.eventId}:rejected`, event: 'red_queen.policy.rejected' });
      signals.push({ eventId: policy?.eventId ?? e.eventId, name: `bounded_verification_${e.payload.verdict}`,
        sentiment: e.payload.verdict === 'passed' ? 'POSITIVE' : 'NEGATIVE',
        type: 'feedback', comment: `${e.payload.exploredScenarios} scenarios; ${e.payload.counterexamples} actual counterexamples. Not a universal proof.` });
    }
  }
  return { events: tracked, signals };
}
