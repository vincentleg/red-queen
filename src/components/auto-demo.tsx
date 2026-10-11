'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { demoSnapshot, demoChapters, eventsThroughChapter, type DemoSnapshot } from '@/lib/demo';
import { requestChallenge } from '@/lib/challenge-client';
import { AttackResults } from './attack';
import { Genome } from './genome';
import type { ChallengeResult } from '@/lib/engine/challenge';
import { milestones } from '@/lib/engine/playback';

type Proof = { results: ChallengeResult[]; challengeId: string; persisted: true };
type Props = { onExit: () => void };
export function AutoDemo({ onExit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [session, setSession] = useState(0);
  const [data, setData] = useState<DemoSnapshot | null>(null);
  const [chapter, setChapter] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [proof, setProof] = useState<Proof | null>(null);
  const [recovered, setRecovered] = useState<DemoSnapshot | null>(null);
  const chapters = useMemo(() => data ? demoChapters(data) : [], [data]);
  const step = chapters[chapter];
  const ready = !!data && !loadError && !operationError && (chapter !== 6 || !!proof) && (chapter !== 7 || !!recovered);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.current?.showModal(); document.body.style.overflow = 'hidden';
    const visibility = () => { if (document.hidden) setPaused(true); };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('visibilitychange', visibility); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setLoadError(''); setOperationError(''); setProof(null); setRecovered(null); setChapter(0); setElapsed(0); setDone(false); setPaused(false);
    fetch('/api/evolution?demo=1', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('Atlas history could not be loaded.');
        const snapshot = await response.json();
        if (!snapshot.run) throw new Error('No completed three-generation experiment is stored yet. Exit, run BEGIN EVOLUTION, then watch the demo.');
        try { return demoSnapshot(snapshot); } catch { throw new Error('The stored run is missing the verified evidence required for this walkthrough. Exit and complete an evolution, or retry.'); }
      }).then(snapshot => { if (!controller.signal.aborted) setData(snapshot); })
      .catch(e => { if (!controller.signal.aborted) setLoadError(e.name === 'TimeoutError' ? 'Atlas took too long to respond. Retry or exit; no result was invented.' : e.message); });
    return () => controller.abort();
  }, [session]);
  useEffect(() => {
    setElapsed(0); setOperationError(''); body.current?.scrollTo({ top: 0, behavior: 'instant' }); heading.current?.focus({ preventScroll: true });
  }, [chapter]);
  useEffect(() => {
    if (!data || (chapter !== 6 && chapter !== 7) || (chapter === 6 && proof) || (chapter === 7 && recovered)) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
    setOperationError('');
    const operation = chapter === 6
      ? requestChallenge(data.run._id, [data.generations[0].policy.id, data.generations[2].policy.id], 'stale_reconciliation', signal)
          .then(result => { if (!controller.signal.aborted) setProof(result); })
      : fetch(`/api/evolution?runId=${data.run._id}`, { cache: 'no-store', signal }).then(async response => {
          if (!response.ok) throw new Error('Atlas readback failed.');
          const result = demoSnapshot(await response.json());
          if (result.run._id !== data.run._id || result.events.length !== data.events.length || result.lineage.length !== data.lineage.length) throw new Error('Recovered evidence does not match this experiment.');
          if (!controller.signal.aborted) setRecovered(result);
        });
    operation.catch(e => { if (!controller.signal.aborted) setOperationError(e.name === 'TimeoutError'
      ? 'The server took too long to respond. No completion is claimed. Retry or exit; a timed-out attack may still have been saved.'
      : 'This operation failed: ' + e.message); });
    return () => controller.abort();
    // Proof is cached for this walkthrough. Re-entering a completed chapter never repeats its request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, data, attempt]);
  useEffect(() => {
    if (!ready || paused || done) return;
    const timer = window.setInterval(() => setElapsed(n => n + 250), 250);
    return () => clearInterval(timer);
  }, [ready, paused, done, chapter]);
  useEffect(() => {
    if (!ready || paused || done || !step || elapsed < step.duration) return;
    if (chapter === 7) { setDone(true); setPaused(true); } else { setElapsed(0); setChapter(c => c + 1); }
  }, [elapsed, ready, paused, done, step, chapter]);
  function move(next: number) { setDone(false); setElapsed(0); setChapter(next); }
  const policy = data && step ? data.generations[step.generation] : null;
  const history = data ? milestones(eventsThroughChapter(data, chapter)).slice(-3) : [];
  return <dialog ref={dialog} className="auto-demo" aria-labelledby="demo-heading" onCancel={e => { e.preventDefault(); onExit(); }}>
    <div className="demo-top"><span className="mono">RED QUEEN / THE EVOLUTION CHAMBER</span><button className="lab-button secondary" onClick={onExit} aria-label="Exit demo">EXIT ✕</button></div>
    <div ref={body} className="demo-body">
      <p className="eyebrow">{data ? `${chapter + 1} / 8 · ${chapter === 6 ? 'LIVE SERVER ATTACK' : chapter === 7 ? 'LIVE ATLAS READBACK' : 'GUIDED PLAYBACK OF A RECORDED RUN'}` : 'LOADING REAL EXPERIMENT EVIDENCE'}</p>
      <h2 ref={heading} tabIndex={-1} id="demo-heading">{done ? 'EVERY FIX MUST SURVIVE ITS OWN ATTACK.' : step?.title ?? 'ENTERING THE CHAMBER'}</h2>
      <p className="demo-explanation">{done ? 'You watched a failing recovery policy evolve, pass independent verification, face a live attack, and return from persistent memory.' : step?.explanation ?? 'Retrieving an actual completed experiment from MongoDB Atlas. No engine results are staged or generated for this presentation.'}</p>
      <p className="demo-disclosure mono">DETERMINISTIC FALLBACK — NOT AI · SIMULATED PAYMENTS · REAL BOUNDED VERIFICATION</p>
      {(loadError || operationError) && <div className="demo-error" role="alert"><p>{loadError || operationError}</p><button className="lab-button" onClick={() => loadError ? setSession(s => s + 1) : setAttempt(a => a + 1)}>RETRY</button><button className="lab-button secondary" onClick={onExit}>EXIT DEMO</button></div>}
      {!ready && !loadError && !operationError && <p className="demo-wait" role="status">{chapter === 6 ? 'Executing both policies on the server and saving the attack evidence…' : chapter === 7 ? 'Reading the exact experiment back from Atlas…' : 'Waiting for Atlas evidence…'}</p>}
      {data && step && policy && <>
        {chapter < 6 && <div className="demo-scene">
          <div className="demo-genome"><Genome key={`${policy.policy.id}-${step.status}`} state={{ policy: policy.policy, status: step.status }} /><span className="mono">GENERATION {policy.policy.version} · {policy.policy.name}</span></div>
          <div className="demo-evidence"><div className="demo-metric"><strong>{step.metric}</strong><span>{step.caption}</span></div>
            {chapter === 2 ? <div className="demo-witness"><p className="mono">STORED COUNTEREXAMPLE / {data.witness.scenario.reconciliation.toUpperCase()} READS</p><ol>{data.witness.execution.trace.map(t => <li key={t.step}><b>{t.action}{t.key ? ' · stable key' : ''}</b><span>{t.fault ?? 'ledger lookup'} → {t.response}</span><strong>{t.ledgerCharges} charge{t.ledgerCharges === 1 ? '' : 's'}</strong></li>)}</ol><p>{data.witness.violations.join(' · ')}</p></div>
            : <><dl className="demo-genes"><div><dt>Retry bound</dt><dd>{policy.policy.maxRetries}</dd></div><div><dt>Reconcile before retry</dt><dd>{policy.policy.reconcileBeforeRetry ? 'Enabled' : 'Disabled'}</dd></div><div><dt>Idempotency</dt><dd>{policy.policy.idempotency}</dd></div></dl><p className="demo-rationale">{policy.rationale}</p></>}
            <div className="demo-records">{history.map(h => <p key={h.event.eventId}><span>✓</span> {h.label}</p>)}</div>
          </div>
        </div>}
        {chapter === 6 && proof && <><AttackResults results={proof.results} /><p className="demo-receipt mono">LIVE ATTACK SAVED TO ATLAS · {proof.challengeId}</p></>}
        {chapter === 7 && recovered && <div className="demo-memory">
          <p className="demo-receipt mono">ATLAS READBACK VERIFIED · RUN {recovered.run._id}</p>
          <div className="demo-memory-metrics"><div><strong>{recovered.events.length}</strong><span>persisted events</span></div><div><strong>{recovered.counterexamples.length}</strong><span>stored counterexamples</span></div><div><strong>{recovered.lineage.length}</strong><span>lineage links</span></div><div><strong>{recovered.scenarios}</strong><span>executed scenarios</span></div></div>
          <div className="demo-lineage">{recovered.generations.map(g => <div key={g.policy.id}><span className="mono">GENERATION {g.policy.version}</span><h3>{g.policy.name}</h3><strong>{g.verification.counterexamples} failing scenarios</strong><p>{g.policy.id === recovered.run.promotedPolicyId ? 'PROMOTED WITHIN BOUNDS' : g.verification.verdict.toUpperCase()}</p></div>)}</div>
          <p className="demo-final">Fail. Learn. Mutate. Attack. Verify. Evolve.</p>
          <p className="bounds-note">This exact run was retrieved again—not reconstructed from the animation. Manual replay and attacks remain available after you exit. {proof ? `Your live comparison was also saved as ${proof.challengeId}.` : ''}</p>
        </div>}
      </>}
    </div>
    <div className="demo-bottom"><div className="demo-progress" role="progressbar" aria-label="Demo chapter" aria-valuemin={1} aria-valuemax={8} aria-valuenow={chapter + 1}>{Array.from({ length: 8 }, (_, i) => <span key={i} className={i < chapter || done ? 'complete' : i === chapter ? 'current' : ''}><i style={{ width: i < chapter || done ? '100%' : i === chapter && step ? `${Math.min(elapsed / step.duration * 100, 100)}%` : '0%' }} /></span>)}</div>
      <div className="demo-controls"><span className="mono">{chapter + 1}/8 · {done ? 'DEMO COMPLETE' : !ready ? 'WAITING' : paused ? 'PAUSED' : 'AUTO PLAY'}</span><button className="lab-button secondary" disabled={!data || chapter === 0} onClick={() => move(chapter - 1)}>PREVIOUS</button><button className="lab-button" disabled={!data || done} onClick={() => setPaused(p => !p)}>{paused ? 'RESUME' : 'PAUSE'}</button><button className="lab-button secondary" disabled={!ready || done} onClick={() => chapter === 7 ? (setDone(true), setPaused(true)) : move(chapter + 1)}>{chapter === 7 ? 'FINISH' : 'NEXT'}</button><button className="lab-button secondary" onClick={() => setSession(s => s + 1)}>RESTART</button></div>
    </div>
  </dialog>;
}
