import { policySchema, type PaymentPolicy } from './policy.ts';

export type Fault = 'ok' | 'timeout_before' | 'timeout_after';
export type Scenario = { id: string; faults: Fault[]; reconciliation: 'fresh' | 'stale' };
export type TraceEntry = { step: number; action: 'charge' | 'reconcile' | 'escalate';
  fault?: Fault; response: string; ledgerCharges: number; key?: string };
export type Execution = { outcome: 'succeeded' | 'escalated'; charges: number;
  attempts: number; steps: number; trace: TraceEntry[] };

// The provider owns its ledger; the recovery policy sees only responses.
// Timeout-after commits before losing the response. Reconciliation can be stale.
class PaymentProvider {
  private ledger: string[] = [];
  private keys = new Set<string>();
  get charges() { return this.ledger.length; }
  charge(fault: Fault, key?: string): 'acknowledged' | 'timeout' {
    if (fault === 'timeout_before') return 'timeout';
    if (!key || !this.keys.has(key)) {
      this.ledger.push('order-001');
      if (key) this.keys.add(key);
    }
    return fault === 'timeout_after' ? 'timeout' : 'acknowledged';
  }
  reconcile(consistency: Scenario['reconciliation']) {
    return consistency === 'fresh' && this.charges > 0 ? 'found' : 'not_found';
  }
}

export function execute(input: PaymentPolicy, scenario: Scenario): Execution {
  const policy = policySchema.parse(input);
  const provider = new PaymentProvider();
  const trace: TraceEntry[] = [];
  let attempts = 0;
  const finish = (outcome: Execution['outcome']): Execution => ({ outcome,
    charges: provider.charges, attempts, steps: trace.length, trace });
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    if (attempt > 0 && policy.reconcileBeforeRetry) {
      const response = provider.reconcile(scenario.reconciliation);
      trace.push({ step: trace.length, action: 'reconcile', response, ledgerCharges: provider.charges });
      if (response === 'found') return finish('succeeded');
    }
    const fault = scenario.faults[attempt];
    if (!fault) throw new Error('Scenario does not cover execution bounds');
    const key = policy.idempotency === 'stable' ? 'order-001' : undefined;
    const response = provider.charge(fault, key);
    attempts++;
    trace.push({ step: trace.length, action: 'charge', fault, response, ledgerCharges: provider.charges, ...(key ? { key } : {}) });
    if (response === 'acknowledged') return finish('succeeded');
  }
  trace.push({ step: trace.length, action: 'escalate', response: 'manual_review', ledgerCharges: provider.charges });
  return finish('escalated');
}
