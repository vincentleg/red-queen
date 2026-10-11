import { execute, type Execution, type Fault, type Scenario } from './simulator.ts';
import { policySchema, type PaymentPolicy } from './policy.ts';

export const BOUNDS = { maxAttempts: 3, maxSteps: 6, maxFaults: 3, scenarioCount: 54 } as const;
export const MODEL = 'payment-v1: one order, serial attempts, durable idempotency keys, fresh or stale reconciliation';
export type Counterexample = { scenario: Scenario; violations: string[]; execution: Execution };
export type Verification = { verdict: 'passed' | 'rejected'; explored: number;
  bounds: typeof BOUNDS; counterexamples: Counterexample[]; executions: { scenario: Scenario; execution: Execution }[] };

export function enumerateScenarios(): Scenario[] {
  const outcomes: Fault[] = ['ok', 'timeout_before', 'timeout_after'];
  const scenarios: Scenario[] = [];
  for (const reconciliation of ['fresh', 'stale'] as const)
    for (const a of outcomes) for (const b of outcomes) for (const c of outcomes)
      scenarios.push({ id: `${reconciliation}:${a},${b},${c}`, faults: [a, b, c], reconciliation });
  return scenarios;
}

// Independent oracle reads actual provider ledger and traces, never policy labels.
// Liveness: with a scenario, a policy that gives up while the provider would have accepted
// a charge within the attempt bound is rejected (prevents "never retry" from passing).
export function checkInvariants(result: Execution, scenario?: Scenario): string[] {
  const violations: string[] = [];
  if (result.charges > 1) violations.push('at_most_one_charge');
  if (result.outcome === 'succeeded' && result.charges !== 1) violations.push('success_requires_exactly_one_charge');
  if (result.steps > BOUNDS.maxSteps || result.attempts > BOUNDS.maxAttempts) violations.push('bounded_termination');
  const evidenceOfSuccess = result.trace.some(t => t.response === 'acknowledged' || t.response === 'found');
  if (evidenceOfSuccess && result.outcome !== 'succeeded') violations.push('acknowledged_payment_completes');
  if (scenario?.faults.slice(0, BOUNDS.maxAttempts).includes('ok') && result.outcome !== 'succeeded') violations.push('recovers_when_provider_available');
  return violations;
}

export function verify(input: PaymentPolicy): Verification {
  const policy = policySchema.parse(input);
  const executions = enumerateScenarios().map(scenario => ({ scenario, execution: execute(policy, scenario) }));
  const counterexamples = executions.flatMap(({ scenario, execution }) => {
    const violations = checkInvariants(execution, scenario);
    return violations.length ? [{ scenario, execution, violations }] : [];
  });
  return { verdict: counterexamples.length ? 'rejected' : 'passed', explored: executions.length,
    bounds: BOUNDS, counterexamples, executions };
}

export function canPromote(result: Verification): boolean {
  return result.verdict === 'passed' && result.explored === BOUNDS.scenarioCount
    && result.executions.length === BOUNDS.scenarioCount && result.counterexamples.length === 0
    && new Set(result.executions.map(x => x.scenario.id)).size === BOUNDS.scenarioCount
    && result.executions.every(x => checkInvariants(x.execution, x.scenario).length === 0);
}
