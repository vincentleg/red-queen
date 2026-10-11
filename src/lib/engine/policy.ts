import { z } from 'zod';

export const policySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(1).max(3),
  name: z.string().min(1).max(80),
  maxRetries: z.number().int().min(0).max(2),
  reconcileBeforeRetry: z.boolean(),
  idempotency: z.enum(['none', 'stable']),
  onExhaustion: z.literal('escalate'),
}).strict();
export type PaymentPolicy = z.infer<typeof policySchema>;

export function baseline(id: string): PaymentPolicy {
  return policySchema.parse({ id, version: 1, name: 'Blind retry', maxRetries: 2,
    reconcileBeforeRetry: false, idempotency: 'none', onExhaustion: 'escalate' });
}

// Deterministic, counterexample-guided mutations. No LLM or executable policy code.
export function propose(parent: PaymentPolicy, id: string, violations: string[]): PaymentPolicy {
  if (!violations.includes('at_most_one_charge')) throw new Error('No supported mutation for evidence');
  if (!parent.reconcileBeforeRetry) return policySchema.parse({ ...parent, id,
    version: parent.version + 1, name: 'Reconcile, then retry', reconcileBeforeRetry: true });
  return policySchema.parse({ ...parent, id, version: parent.version + 1,
    name: 'Reconcile + stable idempotency', idempotency: 'stable' });
}
