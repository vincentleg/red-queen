'use client';
import { useRef, useState } from 'react';
import { attacks, type AttackName, type ChallengeResult } from '@/lib/engine/challenge';
import { requestChallenge } from '@/lib/challenge-client';
import type { EngineEvent } from '@/lib/engine/events';

export function AttackGenome({ events, busy }: { events: EngineEvent[]; busy: boolean }) {
  const policies = events.filter(e => e.type === 'policy.proposed');
  const [attack, setAttack] = useState<AttackName>('stale_reconciliation');
  const [selected, setSelected] = useState('');
  const [results, setResults] = useState<ChallengeResult[]>([]);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const runId = events[0]?.experimentId;
  const chosen = policies.find(p => p.payload.policy.id === selected) ?? policies.at(-1);
  const promoted = policies.find(p => events.some(e => e.type === 'policy.promoted' && e.payload.policyId === p.payload.policy.id));
  async function run(compare: boolean) {
    if (!chosen || busy || lock.current) return;
    lock.current = true; setPending(true); setError(''); setResults([]); setReceipt('');
    try {
      const policyIds = compare && promoted ? [policies[0].payload.policy.id, promoted.payload.policy.id] : [chosen.payload.policy.id];
      const data = await requestChallenge(runId!, policyIds, attack);
      setResults(data.results); setReceipt(data.persisted ? data.challengeId : '');
    } catch (e) { setError(e instanceof Error && e.name === 'TimeoutError' ? 'Request timed out; the server may still have persisted this challenge.' : e instanceof Error ? e.message : 'Challenge unavailable'); }
    finally { lock.current = false; setPending(false); }
  }
  return <section className="attack-lab" aria-labelledby="attack-title">
    <div className="results-heading"><div><p className="eyebrow">YOUR TURN TO FIND THE BREAKING POINT</p><h2 id="attack-title">ATTACK THE GENOME</h2></div><span className="mono">REAL EXECUTION / SIMULATED PAYMENTS</span></div>
    <p className="attack-intro">One order. The same fault. Different recovery strategies.</p>
    {!policies.length ? <p className="bounds-note">Begin an evolution to unlock its stored genomes.</p> : <>
      <div className="attack-controls">
        <label>Failure pattern<select value={attack} disabled={pending} onChange={e => { setAttack(e.target.value as AttackName); setResults([]); setReceipt(''); }}>{Object.entries(attacks).map(([id, a]) => <option key={id} value={id}>{a.name}</option>)}</select></label>
        <label>Policy genome<select value={chosen?.payload.policy.id} disabled={pending} onChange={e => { setSelected(e.target.value); setResults([]); setReceipt(''); }}>{policies.map(p => <option key={p.payload.policy.id} value={p.payload.policy.id}>Generation {p.payload.policy.version} · {p.payload.policy.name}</option>)}</select></label>
        <button className="lab-button" disabled={pending || busy} onClick={() => run(false)}>{pending ? 'EXECUTING…' : 'LAUNCH ATTACK ↗'}</button>
        <button className="lab-button secondary" disabled={pending || busy || !promoted} onClick={() => run(true)}>BASELINE vs PROMOTED</button>
      </div>
      <p className="bounds-note">{attacks[attack].detail} Ledger reads: {attacks[attack].reconciliation}. Each challenge executes the server simulator and stores its evidence in Atlas.</p>
      {error && <p className="engine-error" role="alert">{error}</p>}
      <AttackResults results={results} />
      {receipt && <p className="run-id">ATLAS EVIDENCE SAVED · {receipt}</p>}
    </>}
  </section>;
}

export function AttackResults({ results }: { results: ChallengeResult[] }) {
  return <div className="attack-results" aria-live="polite">{results.map(r => <article key={r.policyId} className={`attack-result ${r.verdict}`}>
        <p className="eyebrow">GENERATION {String(r.generation).padStart(2, '0')} · {r.name}</p>
        <h3>{r.verdict === 'survived' ? 'ATTACK SURVIVED' : 'INVARIANT VIOLATED'}</h3>
        <div className="ledger"><strong>{r.execution.charges}</strong><span>LEDGER CHARGES<br />FOR ONE ORDER</span></div>
        <p>{r.execution.outcome === 'succeeded' ? 'Policy reports success' : 'Escalated to manual review'} · {r.execution.attempts} charge attempts</p>
        <div className="trace-scroll"><table><thead><tr><th>Call</th><th>Fault → response</th><th>Ledger</th></tr></thead><tbody>{r.execution.trace.map(t => <tr key={t.step}><td>{t.step + 1}. {t.action}{t.key ? ' [stable key]' : ''}</td><td>{t.fault ?? '—'} → {t.response}</td><td>{t.ledgerCharges}</td></tr>)}</tbody></table></div>
        <p className="attack-verdict">{r.violations.length ? r.violations.join(' · ') : 'All checked invariants hold for this scenario.'}</p>
        <p className="bounds-note">{r.violations.length ? 'This execution is a concrete counterexample.' : 'One survived attack does not establish universal correctness.'}</p>
      </article>)}</div>;
}
