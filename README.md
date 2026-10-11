# RED QUEEN 2.0 — The Evolution Chamber

**Every fix must survive its own attack.**

A working counterexample-guided payment-recovery experiment with a cinematic Next.js interface and persistent MongoDB Atlas memory.

## Run

Use Node.js 22.20 or later. Run `npm ci`. Preserve the existing `.env.local`; for a fresh checkout, copy `.env.example` and set a valid server-only `MONGODB_URI`. `MONGODB_DB` defaults to `red_queen`.

```sh
npm run dev
npm test
npm run build
npm run check:mongodb
npm run check:evolution
```

`check:evolution` writes a real experiment to Atlas, reads back all five record types, and replays every counterexample. It requires collection-write access. Secrets are excluded from Git, Vercel source uploads, and client bundles.

## The real engine

1. A payment provider simulates a ledger, durable idempotency keys, and timeouts before or after committing a charge.
2. A strict Zod-validated policy interpreter controls reconciliation, bounded retries, stable idempotency, and escalation. It never executes generated code.
3. An independent verifier enumerates all **54 scenarios per policy**: three possible outcomes across three attempts, with fresh or stale reconciliation. It checks ledger safety, truthful success, bounded termination, and completion after acknowledgement.
4. A blind-retry baseline fails on duplicate charges. The first counterexample-guided mutation adds reconciliation, but stale reads expose another duplicate. A second mutation adds stable idempotency. Promotion occurs only if the actual verification result passes the complete bounded suite.
5. Candidate generation is **deterministic, not LLM-driven**. There are no external model calls, live payment charges, or fabricated outcomes.

Bounds: one order, at most three charge attempts and six interpreter steps, at most three injected faults. Provider idempotency is assumed durable; concurrent orders, key expiry, provider corruption, and real payment integrations are outside this model. Passing is not universal verification. Escalation is permitted when the payment outcome cannot be established.

## Persistence and UI

Atlas stores `runs`, `policies`, `counterexamples` (including executable scenario data and ledger traces), `events`, and `lineage`. A short-lived database lock prevents simultaneous chamber runs. Evidence is persisted before events are streamed; execution events are delivered in ordered batches after actual simulation. An incomplete storage operation cannot produce a completed-run success response. Multi-document writes are not transactional; partial failed-run records are retained for inspection.

The existing BEGIN EVOLUTION control starts a real run. The chamber shows actual policy generations, verdicts, counts, and counterexample traces. Reloading restores the latest persisted experiment. The genome remains conceptual artwork; its surrounding labels and active styling reflect engine events.

## API

- `GET /api/health`: authenticated Atlas ping; HTTP 200 when connected, HTTP 503 otherwise. No raw driver errors.
- `POST /api/evolution`: bounded experiment, streamed as NDJSON; HTTP 409 if another run holds the chamber lock, 503 if initial persistence is unavailable.
- `GET /api/evolution?runId=<uuid>`: persisted run, policies, counterexamples, ordered events, and lineage. Omit the ID for the latest run.

This is a shared hackathon chamber, not a multi-tenant service. Deploy behind the existing Vercel deployment protection when access needs restricting. Configure `MONGODB_URI` as a sensitive server-only Vercel variable for the deployment environment. Webpack is used for compatibility with the local sandbox. No new dependencies are needed for the engine.

## AI-driven evolution

Set `ANTHROPIC_API_KEY` (and optionally `RED_QUEEN_MODEL`, default `claude-opus-5-5`) to switch the chamber into AI mode.
Each generation (max 4) the model receives the current policy, real counterexample traces, the verification history
and any rejected-proposal feedback, and returns a JSON policy validated with Zod (never executed). Duplicates and
invalid output are refused before verification (max 2 attempts per generation, 25s per call, 110s total model budget).
Every candidate must pass all 54 bounded scenarios to be promoted. Without a key, or when the model fails, a
deterministic mutation is used and labeled `DETERMINISTIC FALLBACK · NOT AI`. Proposals, provider/model metadata,
verdicts, lineage and run mode are persisted in MongoDB (`proposals`, `policies`, `lineage`, `events`, `runs`).
