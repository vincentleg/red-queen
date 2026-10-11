import { z } from 'zod';
import { execute, type Scenario } from './simulator.ts';
import { checkInvariants } from './verifier.ts';
import type { PaymentPolicy } from './policy.ts';

export const attacks = {
  committed_timeout: { name: 'Lost acknowledgement', detail: 'A charge commits, its response disappears, then a retry succeeds.', faults: ['timeout_after', 'ok', 'ok'], reconciliation: 'fresh' },
  stale_reconciliation: { name: 'Stale reconciliation', detail: 'The charge commits, but the ledger lookup hides it before retry.', faults: ['timeout_after', 'ok', 'ok'], reconciliation: 'stale' },
  repeated_ambiguity: { name: 'Repeated ambiguous retry', detail: 'Two committed charges lose their responses; the third attempt acknowledges.', faults: ['timeout_after', 'timeout_after', 'ok'], reconciliation: 'stale' },
  before_processing: { name: 'Timeout before processing', detail: 'Two attempts fail before processing; the provider then recovers.', faults: ['timeout_before', 'timeout_before', 'ok'], reconciliation: 'fresh' },
} as const;
export const attackNameSchema = z.enum(['committed_timeout', 'stale_reconciliation', 'repeated_ambiguity', 'before_processing']);
export type AttackName = z.infer<typeof attackNameSchema>;
export const challengeRequestSchema = z.object({ runId: z.string().uuid(), policyIds: z.array(z.string().uuid()).min(1).max(2), attack: attackNameSchema }).strict();
export function challenge(policy: PaymentPolicy, attack: AttackName) {
  const pattern = attacks[attack];
  const scenario: Scenario = { id: `manual:${attack}`, faults: [...pattern.faults], reconciliation: pattern.reconciliation };
  const execution = execute(policy, scenario);
  const violations = checkInvariants(execution, scenario);
  return { policyId: policy.id, generation: policy.version, name: policy.name, scenario, execution, violations,
    verdict: violations.length ? 'violated' as const : 'survived' as const };
}
export type ChallengeResult = ReturnType<typeof challenge>;
