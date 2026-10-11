import { z } from 'zod';
import { policySchema } from './policy.ts';
export { policySchema as recoveryPolicySchema } from './policy.ts';
export type { PaymentPolicy as RecoveryPolicy } from './policy.ts';

const envelope = { schemaVersion: z.literal(1), eventId: z.string().uuid(), experimentId: z.string().uuid(),
  sequence: z.number().int().nonnegative(), occurredAt: z.string().datetime() };
const event = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ ...envelope, type: z.literal(type), payload }).strict();
const policyId = z.string().uuid();
export const verificationBoundsSchema = z.object({ maxAttempts: z.number().int().positive(), maxSteps: z.number().int().positive(), maxFaults: z.number().int().nonnegative(), scenarioCount: z.number().int().positive() }).strict();
const llm = { provider: z.string().max(40).optional(), llmModel: z.string().max(80).optional() };
const generation = z.number().int().min(1).max(4);
export const proposalRejectionSchema = z.enum(['invalid_schema', 'duplicate', 'model_error', 'timeout', 'refusal', 'truncated', 'budget_exhausted']);
export const engineEventSchema = z.discriminatedUnion('type', [
  event('run.started', z.object({ generator: z.enum(['deterministic', 'ai']), model: z.string(), ...llm })),
  event('memory.recalled', z.object({ sourceRunId: z.string().uuid(), failureCount: z.number().int().min(1).max(2), usage: z.enum(['ai_context', 'reference']) })),
  event('policy.proposed', z.object({ policy: policySchema, parentPolicyId: policyId.nullable(), rationale: z.string(),
    origin: z.enum(['seed', 'ai', 'deterministic_fallback']).optional(), analysis: z.string().max(600).optional(), attempt: z.number().int().optional(), ...llm })),
  event('proposal.requested', z.object({ generation, attempt: z.number().int().min(1).max(2), provider: z.string(), llmModel: z.string() })),
  event('proposal.rejected', z.object({ generation, attempt: z.number().int().min(1).max(2), reason: proposalRejectionSchema, detail: z.string().max(300) })),
  event('proposal.fallback', z.object({ generation, reason: z.enum(['ai_not_configured', 'ai_attempts_exhausted', 'time_budget_exhausted']) })),
  event('verification.started', z.object({ policyId, bounds: verificationBoundsSchema })),
  event('execution.started', z.object({ policyId, scenarioId: z.string() })),
  event('fault.injected', z.object({ policyId, scenarioId: z.string(), step: z.number().int(), kind: z.enum(['timeout_before', 'timeout_after']) })),
  event('execution.completed', z.object({ policyId, scenarioId: z.string(), outcome: z.enum(['succeeded', 'escalated']), charges: z.number().int(), steps: z.number().int() })),
  event('verification.counterexample', z.object({ policyId, counterexampleId: z.string().uuid(), scenarioId: z.string(), violations: z.array(z.string()), charges: z.number().int() })),
  event('verification.completed', z.object({ policyId, verdict: z.enum(['passed', 'rejected']), exploredScenarios: z.number().int(), counterexamples: z.number().int(), bounds: verificationBoundsSchema })),
  event('policy.promoted', z.object({ policyId, previousPolicyId: policyId, verificationEventId: z.string().uuid() })),
  event('run.completed', z.object({ promotedPolicyId: policyId, persisted: z.literal(true) })),
  event('run.failed', z.object({ category: z.enum(['storage_or_engine_failure', 'execution_limit', 'search_exhausted']) })),
]);
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type EngineEventType = EngineEvent['type'];
export type EventInput = EngineEvent extends infer E ? E extends EngineEvent ? Pick<E, 'type' | 'payload'> : never : never;
export type ProposalRejection = z.infer<typeof proposalRejectionSchema>;
