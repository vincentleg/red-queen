import type { AttackName, ChallengeResult } from './engine/challenge';
export async function requestChallenge(runId: string, policyIds: string[], attack: AttackName, signal?: AbortSignal) {
  const response = await fetch('/api/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, policyIds, attack }), signal: signal ?? AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Challenge unavailable');
  if (!data.persisted || !data.challengeId || !Array.isArray(data.results) || data.results.length !== policyIds.length
    || data.results.some((r: ChallengeResult, i: number) => r.policyId !== policyIds[i] || !Number.isInteger(r.execution?.charges))) throw new Error('The server did not return complete persisted attack evidence.');
  return data as { results: ChallengeResult[]; challengeId: string; persisted: true };
}
