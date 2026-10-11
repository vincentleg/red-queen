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
export const engineEventSchema = z.discriminatedUnion('type', [
  event('run.started', z.object({ generator: z.literal('deterministic'), model: z.string() })),
  event('policy.proposed', z.object({ policy: policySchema, parentPolicyId: policyId.nullable(), rationale: z.string() })),
  event('verification.started', z.object({ policyId, bounds: verificationBoundsSchema })),
  event('execution.started', z.object({ policyId, scenarioId: z.string() })),
  event('fault.injected', z.object({ policyId, scenarioId: z.string(), step: z.number().int(), kind: z.enum(['timeout_before', 'timeout_after']) })),
  event('execution.completed', z.object({ policyId, scenarioId: z.string(), outcome: z.enum(['succeeded', 'escalated']), charges: z.number().int(), steps: z.number().int() })),
  event('verification.counterexample', z.object({ policyId, counterexampleId: z.string().uuid(), scenarioId: z.string(), violations: z.array(z.string()), charges: z.number().int() })),
  event('verification.completed', z.object({ policyId, verdict: z.enum(['passed', 'rejected']), exploredScenarios: z.number().int(), counterexamples: z.number().int(), bounds: verificationBoundsSchema })),
  event('policy.promoted', z.object({ policyId, previousPolicyId: policyId, verificationEventId: z.string().uuid() })),
  event('run.completed', z.object({ promotedPolicyId: policyId, persisted: z.literal(true) })),
  event('run.failed', z.object({ category: z.enum(['storage_or_engine_failure', 'execution_limit']) })),
]);
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type EngineEventType = EngineEvent['type'];
export type EventInput = EngineEvent extends infer E ? E extends EngineEvent ? Pick<E, 'type' | 'payload'> : never : never;
