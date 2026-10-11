import { z } from 'zod';
import { engineEventSchema, type EngineEvent } from './engine/events.ts';
import type { Counterexample } from './engine/verifier.ts';

const evidenceSchema = z.object({ policyId: z.string().uuid(), scenario: z.object({ id: z.string(),
  faults: z.array(z.enum(['ok', 'timeout_before', 'timeout_after'])), reconciliation: z.enum(['fresh', 'stale']) }),
  violations: z.array(z.string()), execution: z.object({ outcome: z.enum(['succeeded', 'escalated']), charges: z.number().int(),
    attempts: z.number().int(), steps: z.number().int(), trace: z.array(z.object({ step: z.number().int(), action: z.enum(['charge', 'reconcile', 'escalate']),
      fault: z.enum(['ok', 'timeout_before', 'timeout_after']).optional(), response: z.string(), ledgerCharges: z.number().int(), key: z.string().optional() })) }) });
const snapshotSchema = z.object({ run: z.object({ _id: z.string().uuid(), status: z.literal('completed'), mode: z.literal('deterministic'), promotedPolicyId: z.string().uuid() }),
  events: z.array(engineEventSchema), counterexamples: z.array(evidenceSchema),
  lineage: z.array(z.object({ parentPolicyId: z.string().uuid(), policyId: z.string().uuid() })) });

export function demoSnapshot(input: unknown) {
  const data = snapshotSchema.parse(input);
  const policies = data.events.filter(e => e.type === 'policy.proposed');
  if (policies.length !== 3 || policies.some(p => p.payload.origin === 'ai') || data.events.some(e => e.experimentId !== data.run._id)) throw new Error('A completed three-generation deterministic run is required.');
  const generations = policies.map(p => {
    const verification = data.events.find(e => e.type === 'verification.completed' && e.payload.policyId === p.payload.policy.id);
    if (verification?.type !== 'verification.completed') throw new Error('Missing independent verification evidence.');
    return { ...p.payload, verification: verification.payload };
  });
  const [first, second, third] = generations;
  if (first.policy.idempotency !== 'none' || first.policy.reconcileBeforeRetry || !second.policy.reconcileBeforeRetry || second.policy.idempotency !== 'none'
    || third.policy.idempotency !== 'stable' || first.verification.verdict !== 'rejected' || second.verification.verdict !== 'rejected' || third.verification.verdict !== 'passed'
    || third.verification.counterexamples !== 0 || third.verification.exploredScenarios !== third.verification.bounds.scenarioCount
    || third.policy.id !== data.run.promotedPolicyId || !data.events.some(e => e.type === 'policy.promoted' && e.payload.policyId === third.policy.id)
    || !data.events.some(e => e.type === 'run.completed')) throw new Error('This recorded run does not match the demonstrated policy progression.');
  const witness = data.counterexamples.find(c => c.policyId === first.policy.id && c.execution.charges > 1);
  if (!witness) throw new Error('The baseline has no stored duplicate-charge witness.');
  return { ...data, generations, witness, scenarios: data.events.filter(e => e.type === 'execution.completed').length };
}
export type DemoSnapshot = ReturnType<typeof demoSnapshot>;
export type DemoChapter = { title: string; explanation: string; generation: number; status: 'baseline' | 'rejected' | 'verified' | 'promoted'; duration: number; metric: string; caption: string };
export function demoChapters(data: DemoSnapshot): DemoChapter[] {
  const [a, b, c] = data.generations;
  return [
    { title: 'THE PROBLEM', explanation: 'A payment can succeed even when its reply never arrives. Retry blindly, and one order can be charged twice. Every fix must survive its own attack.', generation: 0, status: 'baseline', duration: 11000, metric: '1 ORDER', caption: 'An uncertain response is not a failed payment.' },
    { title: 'GENERATION 1 — FAILURE', explanation: `${a.policy.name} retries without checking whether the payment already committed. The independent verifier found ${a.verification.counterexamples} failing scenarios.`, generation: 0, status: 'rejected', duration: 14000, metric: String(a.verification.counterexamples), caption: `failing scenarios / ${a.verification.exploredScenarios} executed` },
    { title: 'COUNTEREXAMPLES', explanation: 'A counterexample is a reproducible execution that breaks a rule. This stored trace shows the actual calls, missing responses, and duplicate ledger charges—not a model’s opinion.', generation: 0, status: 'rejected', duration: 13000, metric: String(data.witness.execution.charges), caption: 'actual charges for one order in this witness' },
    { title: 'GENERATION 2 — MUTATION', explanation: `${b.policy.name} checks the ledger before retrying. But stale reads can hide a committed payment. ${b.verification.counterexamples} failing scenarios remain, so this policy is rejected too.`, generation: 1, status: 'rejected', duration: 14000, metric: String(b.verification.counterexamples), caption: `failing scenarios / ${b.verification.exploredScenarios} executed` },
    { title: 'GENERATION 3 — EVOLUTION', explanation: `${c.policy.name} reuses one durable payment key. The simulated provider recognizes repeated requests and avoids charging the order again.`, generation: 2, status: 'verified', duration: 14000, metric: `${c.verification.exploredScenarios} / ${c.verification.bounds.scenarioCount}`, caption: `scenarios checked · ${c.verification.counterexamples} counterexamples` },
    { title: 'PROMOTION', explanation: 'The proposer cannot approve its own fix. Only the independent verifier can open the promotion gate after every declared scenario passes. This is bounded verification, not universal correctness.', generation: 2, status: 'promoted', duration: 11000, metric: 'PROMOTED', caption: 'Verdict and lineage stored before promotion.' },
    { title: 'LIVE ATTACK — THE PROOF', explanation: 'Now the server runs the same stale-ledger attack against the stored baseline and promoted policy. These results are computed now and saved to Atlas.', generation: 2, status: 'promoted', duration: 14000, metric: 'SAME ATTACK', caption: 'One scenario. Two policies. Real simulator executions.' },
    { title: 'PERSISTENT MEMORY', explanation: 'The experiment survives a refresh. We read this exact run back from MongoDB Atlas: its events, failed policies, counterexamples, and lineage. Previous failures can inform the next experiment.', generation: 2, status: 'promoted', duration: 12000, metric: String(data.events.length), caption: 'recorded events in this Atlas experiment' },
  ];
}
export function eventsThroughChapter(data: DemoSnapshot, chapter: number): EngineEvent[] {
  const generation = chapter < 3 ? 0 : chapter === 3 ? 1 : 2;
  const target = data.generations[generation].policy.id;
  const type = chapter >= 5 ? 'policy.promoted' : chapter === 0 ? 'policy.proposed' : 'verification.completed';
  const index = data.events.findIndex(e => e.type === type && (e.type === 'policy.proposed' ? e.payload.policy.id : 'policyId' in e.payload ? e.payload.policyId : '') === target);
  return data.events.slice(0, index + 1);
}
export type DemoWitness = Counterexample & { policyId: string };
