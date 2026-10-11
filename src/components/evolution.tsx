'use client';

import { useEffect, useRef, useState } from 'react';
import { engineEventSchema, type EngineEvent } from '@/lib/engine/events';
import type { Counterexample } from '@/lib/engine/verifier';

type Evidence = Counterexample & { policyId: string };
export function useEvolution() {
  const started = useRef(false);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/evolution', { cache: 'no-store', signal: controller.signal })
      .then(r => r.ok ? r.json() : null).then(data => {
        if (!started.current && data?.events?.length) {
          setEvents(data.events.map((e: unknown) => engineEventSchema.parse(e)));
          setEvidence(data.counterexamples ?? []); setRestored(true);
          if (data.run?.status === 'running') setError('Latest run has no final verdict yet. Another session may be running it.');
          if (data.run?.status === 'failed') setError('The latest stored run failed. Its evidence is retained.');
        }
      }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const start = async () => {
    if (busy) return;
    started.current = true;
    setBusy(true); setError(''); setEvents([]); setEvidence([]); setRestored(false);
    let completed = false;
    let runId = '';
    try {
      const response = await fetch('/api/evolution', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not start evolution.');
      }
      if (!response.body) throw new Error('Event stream unavailable.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      for (;;) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n'); pending = lines.pop() ?? '';
        const batch = lines.filter(Boolean).map(line => engineEventSchema.parse(JSON.parse(line)));
        if (batch.length) {
          runId = batch[0].experimentId;
          setEvents(previous => [...previous, ...batch]);
          completed ||= batch.some(e => e.type === 'run.completed');
          if (batch.some(e => e.type === 'run.failed')) throw new Error('Run failed: persistence or engine error. No completed-run claim is available.');
        }
        if (done) break;
      }
      if (!completed) throw new Error('Stream interrupted. No completed result received; reload to recover stored evidence.');
      const history = await fetch(`/api/evolution?runId=${runId}`, { cache: 'no-store' });
      if (!history.ok) throw new Error('Run finished; Atlas evidence could not be reloaded.');
      const data = await history.json(); setEvidence(data.counterexamples ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Run unavailable.');
    } finally { setBusy(false); }
  };
  return { events, evidence, busy, error, restored, start };
}
export type EvolutionState = ReturnType<typeof useEvolution>;

const rejections = (events: EngineEvent[], generation: number) =>
  events.filter(e => (e.type === 'proposal.rejected' || e.type === 'proposal.fallback') && e.payload.generation === generation);

function runMode(events: EngineEvent[]) {
  const started = events.find(e => e.type === 'run.started');
  if (started?.type !== 'run.started') return null;
  return started.payload.generator === 'ai' ? { ai: true, label: `AI PROPOSER · ${started.payload.llmModel ?? 'MODEL'}` } : { ai: false, label: 'DETERMINISTIC CANDIDATES · AI NOT CONFIGURED' };
}

export function EvolutionControl({ state }: { state: EvolutionState }) {
  const mode = runMode(state.events);
  return <div className="activation">
    <button disabled={state.busy} onClick={state.start} aria-describedby="engine-note"><span className="button-icon">↗</span>{state.busy ? 'EVOLUTION IN PROGRESS' : 'BEGIN EVOLUTION'}<span className="button-lock" aria-hidden="true">{state.busy ? '·' : '+'}</span></button>
    <p id="engine-note"><span /> {mode ? mode.label.toUpperCase() : 'COUNTEREXAMPLE-GUIDED CANDIDATES'} <b>·</b> REAL BOUNDED VERIFICATION</p>
    {state.error && <p className="engine-error" role="alert">{state.error}</p>}
  </div>;
}

export function EvolutionResults({ state }: { state: EvolutionState }) {
  const [selected, setSelected] = useState(0);
  const policies = state.events.filter(e => e.type === 'policy.proposed');
  const completed = state.events.some(e => e.type === 'run.completed');
  const executions = state.events.filter(e => e.type === 'execution.completed');
  const faults = state.events.filter(e => e.type === 'fault.injected');
  const current = state.evidence[Math.min(selected, state.evidence.length - 1)];
  const mode = runMode(state.events);
  const last = state.events.at(-1);
  if (!state.events.length) return null;
  return <section className="evolution-results" aria-label="Real evolution results">
    <div className="results-heading"><p className="eyebrow">{state.restored ? 'RESTORED FROM ATLAS' : 'LIVE EXPERIMENT RECORD'}</p><span className="mono" role="status">{completed ? 'RUN COMPLETE / PERSISTED' : state.busy ? 'EXECUTING' : 'NO COMPLETED VERDICT'}</span></div>
    <p className="run-id mono">RUN {state.events[0].experimentId}</p>
    <div className="execution-counts mono">{executions.length} SCENARIOS EXECUTED <span>/</span> {faults.length} FAULTS INJECTED <span>/</span> {state.events.filter(e => e.type === 'verification.counterexample').length} COUNTEREXAMPLES</div>
    {state.busy && rejections(state.events, policies.length + 1).map(r => r.type === 'proposal.rejected' && <p key={r.eventId} className="proposal-rejected mono">GENERATION {String(r.payload.generation).padStart(2, '0')} · AI ATTEMPT {r.payload.attempt} REFUSED BEFORE VERIFICATION · {r.payload.reason.replaceAll('_', ' ').toUpperCase()} — {r.payload.detail}</p>)}
    {state.busy && last?.type === 'proposal.requested' && <p className="ai-thinking mono" role="status"><i /> {last.payload.llmModel.toUpperCase()} ANALYZING COUNTEREXAMPLES · GENERATION {String(last.payload.generation).padStart(2, '0')} · ATTEMPT {last.payload.attempt}/2</p>}
    <div className="policy-lineage">{policies.map(({ payload }) => {
      const verdict = state.events.find(e => e.type === 'verification.completed' && e.payload.policyId === payload.policy.id);
      const promoted = state.events.some(e => e.type === 'policy.promoted' && e.payload.policyId === payload.policy.id);
      return <article key={payload.policy.id} className={`policy-record ${promoted ? 'promoted' : ''}`}>
        <span className="mono">GENERATION {payload.policy.version.toString().padStart(2, '0')}</span>
        <em className={`origin mono ${payload.origin ?? 'seed'}`}>{payload.origin === 'ai' ? `AI PROPOSAL · ${payload.llmModel}${payload.attempt && payload.attempt > 1 ? ` · ATTEMPT ${payload.attempt}` : ''}` : payload.origin === 'deterministic_fallback' ? 'DETERMINISTIC FALLBACK · NOT AI' : payload.origin === 'seed' ? 'SEED POLICY' : 'DETERMINISTIC'}</em>
        <h2>{payload.policy.name}</h2>
        {rejections(state.events, payload.policy.version).map(r => <p key={r.eventId} className="proposal-rejected mono">{r.type === 'proposal.rejected' ? `AI ATTEMPT ${r.payload.attempt} REFUSED BEFORE VERIFICATION · ${r.payload.reason.replaceAll('_', ' ').toUpperCase()} — ${r.payload.detail}` : r.type === 'proposal.fallback' ? `FALLBACK ENGAGED · ${r.payload.reason.replaceAll('_', ' ').toUpperCase()}` : ''}</p>)}
        {payload.analysis && <p className="ai-analysis"><b className="mono">AI ANALYSIS</b> {payload.analysis}</p>}
        <p>{payload.rationale}</p><dl><div><dt>Reconcile</dt><dd>{payload.policy.reconcileBeforeRetry ? 'Before retry' : 'Disabled'}</dd></div><div><dt>Idempotency</dt><dd>{payload.policy.idempotency}</dd></div><div><dt>Retry bound</dt><dd>{payload.policy.maxRetries}</dd></div></dl>
        <strong className="mono">{promoted ? 'PROMOTED WITHIN BOUNDS' : verdict?.type === 'verification.completed' ? verdict.payload.verdict.toUpperCase() : 'VERIFYING'}</strong>
        {verdict?.type === 'verification.completed' && <p className="verification-count">{verdict.payload.exploredScenarios} scenarios · {verdict.payload.counterexamples} counterexamples</p>}
      </article>;
    })}</div>
    {current && <details className="counterexample" open><summary>INSPECT A REAL COUNTEREXAMPLE</summary>
      <label htmlFor="counterexample-select">Scenario </label><select id="counterexample-select" value={Math.min(selected, state.evidence.length - 1)} onChange={e => setSelected(Number(e.target.value))}>{state.evidence.map((c, i) => <option key={`${c.policyId}-${c.scenario.id}`} value={i}>G{policies.find(p => p.payload.policy.id === c.policyId)?.payload.policy.version} / {c.scenario.id}</option>)}</select>
      <p>{current.violations.join(', ')} · {current.execution.charges} actual ledger charges for one order</p>
      <div className="trace-scroll"><table><thead><tr><th>Step</th><th>Action</th><th>Injected fault</th><th>Observed response</th><th>Ledger charges</th></tr></thead><tbody>{current.execution.trace.map(t => <tr key={t.step}><td>{t.step + 1}</td><td>{t.action}</td><td>{t.fault ?? '—'}</td><td>{t.response}</td><td>{t.ledgerCharges}</td></tr>)}</tbody></table></div>
    </details>}
    <p className="bounds-note">Bounded model: one payment, at most 3 attempts / 6 steps, all 54 fault and reconciliation combinations per policy. Provider idempotency keys are durable; reconciliation may be stale. This is a simulated payment system, not a live charge or universal verification. {mode?.ai ? 'Candidates are proposed by a live language model from real counterexamples and verifier feedback; model output is schema-validated data, never executed, and only promoted after passing all 54 scenarios. Fallback candidates are labeled.' : 'Candidate generation in this run is deterministic, not LLM-driven.'}</p>
  </section>;
}
