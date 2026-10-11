import { z } from "zod";

const envelope = {
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  experimentId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
};

// Policies are declarative data. A future interpreter must enforce these limits;
// no generated source, expressions, or executable callbacks are accepted.
export const recoveryPolicySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  maxRetries: z.number().int().min(0).max(5),
  retryDelayMs: z.number().int().min(0).max(10000),
  timeoutMs: z.number().int().min(100).max(30000),
  onExhaustion: z.enum(["abort", "escalate"]),
}).strict();

export const verificationBoundsSchema = z.object({
  maxSteps: z.number().int().positive(),
  maxFaults: z.number().int().nonnegative(),
  scenarioCount: z.number().int().positive(),
}).strict();

const event = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  z.object({ ...envelope, type: z.literal(type), payload }).strict();

export const engineEventSchema = z.discriminatedUnion("type", [
  event("execution.started", z.object({ policyId: z.string().uuid(), seed: z.number().int() }).strict()),
  event("execution.completed", z.object({ outcome: z.enum(["succeeded", "failed", "aborted"]), steps: z.number().int().nonnegative() }).strict()),
  event("fault.injected", z.object({ kind: z.enum(["timeout", "rate_limit", "tool_error", "malformed_response"]), step: z.number().int().nonnegative(), scenarioId: z.string().min(1) }).strict()),
  event("policy.proposed", z.object({ parentPolicyId: z.string().uuid(), policy: recoveryPolicySchema, rationale: z.string().min(1).max(2000) }).strict()),
  event("verification.started", z.object({ policyId: z.string().uuid(), bounds: verificationBoundsSchema }).strict()),
  event("verification.counterexample", z.object({ policyId: z.string().uuid(), scenarioId: z.string().min(1), seed: z.number().int(), failedInvariant: z.string().min(1) }).strict()),
  event("verification.completed", z.object({ policyId: z.string().uuid(), verdict: z.enum(["passed", "rejected", "inconclusive"]), bounds: verificationBoundsSchema, exploredScenarios: z.number().int().nonnegative() }).strict()),
  event("policy.promoted", z.object({ policyId: z.string().uuid(), previousPolicyId: z.string().uuid(), verificationEventId: z.string().uuid() }).strict()),
]);

export type RecoveryPolicy = z.infer<typeof recoveryPolicySchema>;
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type EngineEventType = EngineEvent["type"];
