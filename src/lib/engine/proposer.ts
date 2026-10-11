import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { policyKey, type PaymentPolicy } from './policy.ts';
import type { Counterexample } from './verifier.ts';

// What the model may return. The harness assigns id/version and re-validates with candidateSchema;
// model output is data only and is never executed.
const outputSchema = z.object({
  analysis: z.string(),
  name: z.string(),
  maxRetries: z.number().int(),
  reconcileBeforeRetry: z.boolean(),
  idempotency: z.enum(['none', 'stable']),
  rationale: z.string(),
});
export const candidateSchema = z.object({
  analysis: z.string().min(1).max(400),
  name: z.string().min(1).max(80),
  maxRetries: z.number().int().min(0).max(2),
  reconcileBeforeRetry: z.boolean(),
  idempotency: z.enum(['none', 'stable']),
  rationale: z.string().min(1).max(300),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;

export type GenerationRecord = { version: number; config: string; name: string; origin: string; verdict: 'passed' | 'rejected';
  counterexampleCount: number; violationCounts: Record<string, number> };
export type RejectedProposal = { generation: number; attempt: number; reason: string; detail: string };
export type ProposalContext = { generation: number; attempt: number; currentPolicy: PaymentPolicy;
  counterexamples: Counterexample[]; history: GenerationRecord[]; rejected: RejectedProposal[] };
export type ProposalResult = { output: unknown; stopReason: string | null; usage?: { inputTokens: number; outputTokens: number } };
export type Proposer = { provider: string; model: string; propose(context: ProposalContext): Promise<ProposalResult> };

export class ProposerError extends Error {
  readonly category: 'timeout' | 'model_error';
  readonly detail: string;
  constructor(category: 'timeout' | 'model_error', detail: string) { super(detail); this.category = category; this.detail = detail; }
}

export const SYSTEM_PROMPT = `You are the policy-proposal stage of RED QUEEN, a recursive verification harness.
You design a recovery policy for one payment order against a simulated provider. An independent verifier will
exhaustively attack your policy with 54 fault scenarios; you cannot see or influence the verifier.

Simulator semantics (payment-v1):
- Each attempt calls charge(). Fault per attempt: ok (committed, acknowledged), timeout_before (not committed,
  response lost), timeout_after (COMMITTED on provider ledger, but the response is lost).
- maxRetries (0..2): retries after an unacknowledged attempt; total attempts = maxRetries + 1 (scenarios cover 3).
- reconcileBeforeRetry: before each retry, query the provider ledger. Reads are 'fresh' or 'stale' (stale always
  reports not_found). 'found' ends the run as succeeded.
- idempotency: 'none' sends no key; 'stable' reuses one durable key so the provider never commits the order twice.
- After the final failed attempt the policy escalates to manual review.

Invariants the verifier checks on the real provider ledger:
- at_most_one_charge; success_requires_exactly_one_charge; bounded_termination;
- acknowledged_payment_completes; recovers_when_provider_available (if any of the 3 scenario attempts would
  return ok, the policy must end succeeded).

Task: analyse the supplied counterexamples and verification history, then propose ONE new policy that fixes the
observed violations. It must differ from every configuration already tried. If a previous proposal was rejected,
the feedback explains why; correct it. 'analysis' = one or two sentences naming the concrete failure mechanism in
the evidence (no hidden reasoning, no preamble). 'rationale' = one sentence on why the change fixes it. 'name' = a
short policy name (<= 6 words). Keep analysis under 300 characters.`;

const compactTrace = (c: Counterexample) => c.execution.trace
  .map(t => `${t.action}${t.fault ? `(${t.fault})` : ''}->${t.response} ledger=${t.ledgerCharges}${t.key ? ' key' : ''}`).join('; ');

// Pick a small, diverse evidence set: one witness per distinct violation signature.
export function selectEvidence(counterexamples: Counterexample[], limit = 4): Counterexample[] {
  const seen = new Set<string>();
  return counterexamples.filter(c => {
    const signature = `${c.violations.join(',')}|${c.scenario.reconciliation}`;
    if (seen.has(signature)) return false;
    seen.add(signature); return true;
  }).slice(0, limit);
}

export function buildPrompt(context: ProposalContext): string {
  const p = context.currentPolicy;
  return JSON.stringify({
    generationToPropose: context.generation,
    currentPolicy: { name: p.name, maxRetries: p.maxRetries, reconcileBeforeRetry: p.reconcileBeforeRetry, idempotency: p.idempotency },
    counterexamples: selectEvidence(context.counterexamples).map(c => ({ scenario: c.scenario.id, violations: c.violations,
      ledgerCharges: c.execution.charges, outcome: c.execution.outcome, trace: compactTrace(c) })),
    verificationHistory: context.history,
    rejectedProposals: context.rejected,
    configurationsAlreadyTried: context.history.map(h => h.config),
  }, null, 1);
}

export function validateCandidate(output: unknown, tried: Set<string>):
  { ok: true; candidate: Candidate } | { ok: false; reason: 'invalid_schema' | 'duplicate'; detail: string } {
  const parsed = candidateSchema.safeParse(output);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: 'invalid_schema', detail: `${issue?.path.join('.') || 'output'}: ${issue?.message ?? 'invalid'}`.slice(0, 300) };
  }
  const key = policyKey(parsed.data);
  if (tried.has(key)) return { ok: false, reason: 'duplicate', detail: `Configuration already tried: ${key}` };
  return { ok: true, candidate: parsed.data };
}

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const GEMINI_MODEL = 'gemini-2.5-flash';

function createGeminiProposer(apiKey: string, timeoutMs: number): Proposer {
  return {
    provider: 'google', model: GEMINI_MODEL,
    async propose(context) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: buildPrompt(context) }] }],
            generationConfig: {
              maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 },
              responseMimeType: 'application/json',
              responseJsonSchema: z.toJSONSchema(outputSchema),
            },
          }),
        });
        if (!response.ok) throw new ProposerError('model_error', `Provider returned HTTP ${response.status}`);
        const data = await response.json() as {
          candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
          promptFeedback?: { blockReason?: string };
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const candidate = data.candidates?.[0];
        if (data.promptFeedback?.blockReason) return { output: null, stopReason: 'refusal' };
        if (candidate?.finishReason === 'MAX_TOKENS') return { output: null, stopReason: 'max_tokens' };
        if (candidate?.finishReason !== 'STOP') throw new ProposerError('model_error', 'Model did not complete a policy');
        const text = candidate.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('');
        return {
          output: JSON.parse(text || ''), stopReason: 'end_turn',
          usage: data.usageMetadata ? { inputTokens: data.usageMetadata.promptTokenCount ?? 0,
            outputTokens: data.usageMetadata.candidatesTokenCount ?? 0 } : undefined,
        };
      } catch (error) {
        if (signal.aborted) throw new ProposerError('timeout', 'Model call exceeded timeout');
        if (error instanceof ProposerError) throw error;
        throw new ProposerError('model_error', 'Model request failed or output could not be parsed');
      }
    },
  };
}

// Returns null when no provider credential is configured. Never reads or exposes the key value beyond the client.
export function createProposer(env: Record<string, string | undefined> = process.env, timeoutMs = 25000): Proposer | null {
  if (env.GEMINI_API_KEY) return createGeminiProposer(env.GEMINI_API_KEY, timeoutMs);
  if (!env.ANTHROPIC_API_KEY) return null;
  const model = env.RED_QUEEN_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 0 });
  return {
    provider: 'anthropic', model,
    async propose(context) {
      try {
        const response = await client.messages.parse({
          model, max_tokens: 4000, system: SYSTEM_PROMPT,
          output_config: { effort: 'low', format: zodOutputFormat(outputSchema) },
          messages: [{ role: 'user', content: buildPrompt(context) }],
        });
        return { output: response.parsed_output, stopReason: response.stop_reason,
          usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
      } catch (error) {
        // Only safe categories leave this function: never messages, headers, or request bodies.
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ProposerError('timeout', 'Model call exceeded timeout');
        if (error instanceof Anthropic.APIError) throw new ProposerError('model_error', `Provider returned HTTP ${error.status ?? 'error'}`);
        throw new ProposerError('model_error', 'Model output could not be parsed');
      }
    },
  };
}
