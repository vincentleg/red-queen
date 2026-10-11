import { z } from 'zod';

export const policySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(1).max(4),
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

export const MAX_GENERATIONS = 4;
// Identity of a policy's behaviour, independent of id/version/name. Used to refuse duplicate proposals.
export const policyKey = (p: Pick<PaymentPolicy, 'maxRetries' | 'reconcileBeforeRetry' | 'idempotency'>) =>
  `retries=${p.maxRetries}|reconcile=${p.reconcileBeforeRetry}|idempotency=${p.idempotency}`;

// Deterministic, counterexample-guided mutations. No LLM or executable policy code.
// Used when no model is configured, or as an explicitly labeled fallback when the model fails.
export function propose(parent: PaymentPolicy, id: string, violations: string[], tried: Set<string> = new Set()): PaymentPolicy {
  const mutations: [boolean, Partial<PaymentPolicy> & { name: string }][] = [
    [violations.includes('at_most_one_charge') && !parent.reconcileBeforeRetry, { name: 'Reconcile, then retry', reconcileBeforeRetry: true }],
    [violations.includes('at_most_one_charge') && parent.idempotency === 'none', { name: 'Reconcile + stable idempotency', idempotency: 'stable' }],
    [violations.includes('recovers_when_provider_available') && parent.maxRetries < 2, { name: 'Restore full retry bound', maxRetries: 2 }],
  ];
  for (const [applies, change] of mutations) {
    if (!applies) continue;
    const candidate = policySchema.parse({ ...parent, ...change, id, version: parent.version + 1 });
    if (!tried.has(policyKey(candidate))) return candidate;
  }
  throw new Error('No supported mutation for evidence');
}
