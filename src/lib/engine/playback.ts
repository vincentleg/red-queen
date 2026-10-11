import type { EngineEvent } from './events.ts';
export function milestones(events: EngineEvent[]) {
  const seen = new Set<string>();
  return events.flatMap((event, index) => {
    if (event.type === 'execution.started' || event.type === 'execution.completed') return [];
    if (event.type === 'fault.injected' || event.type === 'verification.counterexample') {
      const key = `${event.type}:${event.payload.policyId}`;
      if (seen.has(key)) return [];
      seen.add(key);
    }
    return [{ event, end: index + 1, label: eventLabel(event) }];
  });
}
export function eventLabel(event: EngineEvent): string {
  switch (event.type) {
    case 'run.started': return 'INITIALIZING EXPERIMENT';
    case 'memory.recalled': return 'RECALLING ATLAS FAILURE MEMORY';
    case 'policy.proposed': return event.payload.origin === 'seed' ? 'LOADING POLICY GENOME' : 'PROPOSING MUTATION';
    case 'verification.started': return 'VERIFYING CANDIDATE';
    case 'fault.injected': return 'INJECTING ADVERSARIAL FAULTS';
    case 'verification.counterexample': return 'COUNTEREXAMPLE DISCOVERED';
    case 'verification.completed': return event.payload.verdict === 'rejected' ? 'POLICY REJECTED' : 'BOUNDED VERIFICATION PASSED';
    case 'proposal.requested': return 'ANALYZING FAILURE · MODEL REQUESTED';
    case 'proposal.fallback': return 'DETERMINISTIC MUTATION · NOT AI';
    case 'proposal.rejected': return 'MODEL CANDIDATE REJECTED';
    case 'policy.promoted': return 'POLICY PROMOTED';
    case 'run.completed': return 'EVOLUTION COMPLETE';
    case 'run.failed': return 'EXPERIMENT FAILED';
    default: return event.type.toUpperCase();
  }
}
