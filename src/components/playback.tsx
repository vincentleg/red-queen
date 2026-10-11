'use client';
import { useEffect, useMemo, useState } from 'react';
import type { EngineEvent } from '@/lib/engine/events';
import { milestones } from '@/lib/engine/playback';

export function usePlayback(events: EngineEvent[], busy: boolean) {
  const steps = useMemo(() => milestones(events), [events]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const runId = events[0]?.experimentId;
  useEffect(() => {
    if (busy) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setCursor(reduced ? null : 0); setPlaying(!reduced);
    } else { setCursor(null); setPlaying(false); }
    // Start presentation once per run; incoming event batches never reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
  useEffect(() => {
    if (!playing || cursor === null) return;
    if (cursor >= steps.length && !busy) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setCursor(c => c === null ? c : Math.min(c + 1, steps.length)), 1150);
    return () => clearTimeout(timer);
  }, [playing, cursor, steps.length, busy]);
  const end = cursor === null ? events.length : cursor === 0 ? 0 : steps[Math.min(cursor, steps.length) - 1]?.end ?? 0;
  return { events: events.slice(0, end), steps, cursor, playing, presenting: cursor !== null,
    replay: () => { setCursor(0); setPlaying(true); },
    toggle: () => { if (cursor === null) setCursor(0); setPlaying(p => !p); },
    seek: (n: number) => { setCursor(n); setPlaying(false); },
    finish: () => { setCursor(null); setPlaying(false); } };
}
export type PlaybackState = ReturnType<typeof usePlayback>;
export function EvolutionPlayback({ playback, busy, stored }: { playback: PlaybackState; busy: boolean; stored: boolean }) {
  const { steps, cursor } = playback;
  const current = steps[(cursor ?? steps.length) - 1];
  if (!steps.length) return null;
  return <section className="playback-panel" aria-label="Evolution event playback">
    <div className="results-heading"><p className="eyebrow">{playback.presenting ? 'RECORDED EVENT PLAYBACK' : stored ? 'ATLAS EXPERIMENT MEMORY' : busy ? 'LIVE SERVER EVENTS' : 'COMPLETED EXPERIMENT'}</p><span className="mono">{busy ? 'SERVER EXECUTING' : 'SERVER EXECUTION FINISHED'}</span></div>
    <h2 key={current?.event.eventId} className="stage-title" aria-live="polite">{current?.label ?? 'AWAITING RECORDED EVENT'}</h2>
    {current && <p className="stage-explanation">{detail(current.event)}</p>}
    <p className="stage-detail mono">{current ? `EVENT ${current.event.sequence + 1} · ${new Date(current.event.occurredAt).toISOString().slice(11, 23)} UTC` : 'Playback begins with the first persisted server event.'}</p>
    <div className="playback-controls"><button className="lab-button" onClick={playback.replay}>REPLAY EVOLUTION ↺</button><button className="lab-button secondary" onClick={playback.toggle}>{playback.playing ? 'PAUSE' : 'PLAY'}</button><button className="lab-button secondary" onClick={playback.finish}>SHOW LATEST RESULT</button><label className="timeline-slider">Event milestone {cursor ?? steps.length} / {steps.length}<input aria-label="Event milestone" type="range" min="0" max={steps.length} value={cursor ?? steps.length} onChange={e => playback.seek(Number(e.target.value))} /></label></div>
    <div className="timeline-steps">{steps.map((s, i) => <button key={s.event.eventId} aria-current={i === (cursor ?? steps.length) - 1 ? 'step' : undefined} className={i < (cursor ?? steps.length) ? 'visited' : ''} onClick={() => playback.seek(i + 1)} title={s.label}><span>{String(i + 1).padStart(2, '0')}</span>{s.label}</button>)}</div>
    <p className="bounds-note">Presentation follows real recorded events. Playback pacing does not represent computation time. Drag or select any milestone to inspect that moment.</p>
  </section>;
}

function detail(e: EngineEvent): string {
  switch (e.type) {
    case 'run.started': return e.payload.generator === 'ai' ? `${e.payload.llmModel} configured. AI origin requires a successful model proposal.` : 'Deterministic recovery policies. Real simulation and verification. NOT AI.';
    case 'memory.recalled': return `${e.payload.failureCount} real rejected-policy witnesses retrieved from experiment ${e.payload.sourceRunId}. ${e.payload.usage === 'ai_context' ? 'Included as additional context in model requests.' : 'Available as historical reference; deterministic mutations use current-run failures.'}`;
    case 'policy.proposed': return `Generation ${e.payload.policy.version}: ${e.payload.policy.name}. ${e.payload.rationale}`;
    case 'fault.injected': return `${e.payload.kind === 'timeout_after' ? 'A payment committed but its acknowledgement was lost.' : 'The request timed out before payment processing.'} Scenario: ${e.payload.scenarioId}`;
    case 'verification.counterexample': return `${e.payload.charges} charges for one order. Violated: ${e.payload.violations.join(', ')}.`;
    case 'verification.completed': return `${e.payload.exploredScenarios} scenarios executed independently. ${e.payload.counterexamples} counterexamples. ${e.payload.verdict === 'rejected' ? 'This policy cannot be promoted.' : 'No violations within these declared bounds.'}`;
    case 'verification.started': return `Independent verifier examining all ${e.payload.bounds.scenarioCount} fault and reconciliation combinations.`;
    case 'proposal.requested': return `${e.payload.llmModel} receives actual counterexamples, generation history and rejected-proposal feedback.`;
    case 'proposal.rejected': return `${e.payload.reason}: ${e.payload.detail}`;
    case 'proposal.fallback': return 'Current failures guide a deterministic policy mutation. This candidate is explicitly not AI-generated.';
    case 'policy.promoted': return 'Promotion follows the independent verification record. The complete lineage is stored in Atlas.';
    case 'run.completed': return 'Experiment and evidence persisted. Challenge the stored genomes below or replay any generation.';
    case 'run.failed': return `Execution stopped: ${e.payload.category}. No completed-run claim.`;
    default: return 'Recorded by the execution engine.';
  }
}
