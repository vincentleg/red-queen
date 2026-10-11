import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Db, Document } from 'mongodb';
import { baseline, propose, policyKey, policySchema, MAX_GENERATIONS, type PaymentPolicy } from './policy.ts';
import { verify, canPromote, BOUNDS, MODEL, type Verification } from './verifier.ts';
import { engineEventSchema, type EngineEvent, type EventInput, type ProposalRejection } from './events.ts';
import type { Candidate, ProposalContext } from './proposer.ts';
import { ProposerError, validateCandidate, type GenerationRecord, type Proposer, type RejectedProposal } from './proposer.ts';

const ATTEMPTS_PER_GENERATION = 2;
// Total wall-clock budget for model calls; verification itself is fast and always runs.
const AI_BUDGET_MS = 110000;

type Origin = 'seed' | 'ai' | 'deterministic_fallback';
type Proposal = { policy: PaymentPolicy; rationale: string; origin: Origin; analysis?: string; attempt?: number };

export async function evolve(db: Db, runId: string, publish: (events: EngineEvent[]) => void, proposer: Proposer | null = null) {
  let sequence = 0;
  const deadline = Date.now() + AI_BUDGET_MS;
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
  const llm = proposer ? { provider: proposer.provider, llmModel: proposer.model } : {};
  const tried = new Set<string>();
  const history: GenerationRecord[] = [];
  const rejected: RejectedProposal[] = [];
  let priorFailures: NonNullable<ProposalContext['priorFailures']> = [];

  // OBSERVE FAILURE -> AI ANALYZES -> AI PROPOSES. Rejected proposals feed the next attempt; verification
  // history feeds the next generation. Falls back to labeled deterministic mutation if the model cannot deliver.
  async function next(parent: PaymentPolicy, result: Verification, generation: number): Promise<Proposal> {
    let reason: 'ai_not_configured' | 'ai_attempts_exhausted' | 'time_budget_exhausted' = 'ai_not_configured';
    if (proposer) {
      reason = 'ai_attempts_exhausted';
      for (let attempt = 1; attempt <= ATTEMPTS_PER_GENERATION; attempt++) {
        if (Date.now() > deadline) { reason = 'time_budget_exhausted'; break; }
        await emit([{ type: 'proposal.requested', payload: { generation, attempt, provider: proposer.provider, llmModel: proposer.model } }]);
        const started = Date.now();
        let verdict: { ok: true; candidate: Candidate } | { ok: false; reason: ProposalRejection; detail: string };
        let output: unknown = null, usage, stopReason: string | null = null;
        try {
          ({ output, usage, stopReason } = await proposer.propose({ generation, attempt, currentPolicy: parent,
            counterexamples: result.counterexamples, history, rejected: [...rejected], priorFailures }));
          verdict = stopReason === 'refusal' ? { ok: false, reason: 'refusal', detail: 'Model declined to propose' }
            : stopReason === 'max_tokens' ? { ok: false, reason: 'truncated', detail: 'Model output hit the token limit' }
            : validateCandidate(output, tried);
        } catch (error) {
          const e = error instanceof ProposerError ? error : new ProposerError('model_error', 'Model call failed');
          verdict = { ok: false, reason: e.category, detail: e.detail };
        }
        await collection('proposals').insertOne({ _id: randomUUID(), runId, generation, attempt, provider: proposer.provider,
          model: proposer.model, parentPolicyId: parent.id, status: verdict.ok ? 'accepted_for_verification' : 'rejected',
          reason: verdict.ok ? null : verdict.reason, detail: verdict.ok ? null : verdict.detail, output, stopReason, usage: usage ?? null,
          latencyMs: Date.now() - started, feedbackReceived: rejected.length, createdAt: new Date() });
        if (verdict.ok) {
          const { analysis, rationale, ...genes } = verdict.candidate;
          const policy = policySchema.parse({ ...genes, id: randomUUID(), version: generation, onExhaustion: 'escalate' });
          return { policy, rationale, analysis, origin: 'ai', attempt };
        }
        rejected.push({ generation, attempt, reason: verdict.reason, detail: verdict.detail });
        await emit([{ type: 'proposal.rejected', payload: { generation, attempt, reason: verdict.reason, detail: verdict.detail } }]);
      }
    }
    await emit([{ type: 'proposal.fallback', payload: { generation, reason } }]);
    const policy = propose(parent, randomUUID(), [...new Set(result.counterexamples.flatMap(c => c.violations))], tried);
    return { policy, origin: 'deterministic_fallback',
      rationale: `Deterministic fallback (not AI): ${describeChange(parent, policy)} in response to observed violations.` };
  }

  try {
    await emit([{ type: 'run.started', payload: { generator: proposer ? 'ai' : 'deterministic', model: MODEL, ...llm } }]);
    // Optional, bounded exact retrieval. No semantic-search or memory-use claim for fallback.
    try {
      const previous = await collection('runs').findOne({ _id: { $ne: runId }, status: 'completed', source: { $ne: 'integration-check-test-double' } }, { sort: { startedAt: -1 } });
      if (previous) {
        const failures = await collection('policies').find({ runId: previous._id, status: 'rejected' }).sort({ 'policy.version': 1 }).limit(2).toArray();
        priorFailures = failures.filter(p => p.sampleCounterexample?.execution?.trace && p.sampleCounterexample?.violations?.length).map(p => ({ sourceRunId: previous._id,
          policy: policySchema.parse(p.policy), counterexample: p.sampleCounterexample }));
      }
    } catch { priorFailures = []; }
    if (priorFailures.length) await emit([{ type: 'memory.recalled', payload: { sourceRunId: priorFailures[0].sourceRunId,
      failureCount: priorFailures.length, usage: proposer ? 'ai_context' : 'reference' } }]);
    let proposal: Proposal = { policy: baseline(randomUUID()), origin: 'seed', rationale: 'Baseline retries ambiguous failures without deduplication.' };
    let parent: PaymentPolicy | null = null;
    for (let generation = 1; generation <= MAX_GENERATIONS; generation++) {
      const { policy, rationale, origin, analysis, attempt } = proposal;
      const meta = origin === 'ai' ? llm : {};
      tried.add(policyKey(policy));
      await collection('policies').insertOne({ _id: policy.id, runId, policy, parentPolicyId: parent?.id ?? null, status: 'proposed',
        generator: origin === 'ai' ? 'ai' : 'deterministic', origin, rationale, analysis: analysis ?? null, ...meta });
      if (parent) await collection('lineage').insertOne({ _id: randomUUID(), runId, parentPolicyId: parent.id, policyId: policy.id,
        relation: origin === 'ai' ? 'ai_mutation' : 'mutation' });
      await emit([{ type: 'policy.proposed', payload: { policy, parentPolicyId: parent?.id ?? null, rationale, origin,
        ...(analysis ? { analysis } : {}), ...(attempt ? { attempt } : {}), ...meta } },
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
      const violationCounts: Record<string, number> = {};
      for (const c of result.counterexamples) for (const v of c.violations) violationCounts[v] = (violationCounts[v] ?? 0) + 1;
      history.push({ version: policy.version, config: policyKey(policy), name: policy.name, origin, verdict: result.verdict,
        counterexampleCount: result.counterexamples.length, violationCounts });
      if (canPromote(result)) {
        // Rejected candidates never enter this branch. All evidence is durable before promotion.
        if (!parent) throw new Error('Expected baseline counterexample');
        await collection('policies').updateOne({ _id: policy.id, status: 'passed' }, { $set: { status: 'promoted' } });
        await emit([{ type: 'policy.promoted', payload: { policyId: policy.id, previousPolicyId: parent.id, verificationEventId: verification.eventId } }]);
        await collection('runs').updateOne({ _id: runId }, { $set: { status: 'completed', promotedPolicyId: policy.id, completedAt: new Date(), bounds: BOUNDS,
          mode: proposer ? 'ai' : 'deterministic', generations: generation, aiProposals: history.filter(h => h.origin === 'ai').length } });
        await emit([{ type: 'run.completed', payload: { promotedPolicyId: policy.id, persisted: true } }]);
        return;
      }
      if (generation === MAX_GENERATIONS) break;
      parent = policy;
      proposal = await next(parent, result, generation + 1);
    }
    throw new SearchExhausted();
  } catch (error) {
    const category = error instanceof SearchExhausted ? 'search_exhausted' : 'storage_or_engine_failure';
    await collection('runs').updateOne({ _id: runId }, { $set: { status: 'failed', failedAt: new Date(), category } }).catch(() => undefined);
    try { await emit([{ type: 'run.failed', payload: { category } }]); }
    catch { publish([engineEventSchema.parse({ type: 'run.failed', payload: { category },
      schemaVersion: 1, eventId: randomUUID(), experimentId: runId, sequence: sequence++, occurredAt: new Date().toISOString() })]); }
  }
}

class SearchExhausted extends Error {}

function describeChange(from: PaymentPolicy, to: PaymentPolicy) {
  const changes = [
    from.reconcileBeforeRetry !== to.reconcileBeforeRetry && `reconcile-before-retry ${to.reconcileBeforeRetry ? 'enabled' : 'disabled'}`,
    from.idempotency !== to.idempotency && `idempotency ${to.idempotency}`,
    from.maxRetries !== to.maxRetries && `retry bound ${to.maxRetries}`,
  ].filter(Boolean);
  return changes.join(', ') || 'no change';
}
