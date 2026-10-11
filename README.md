# RED QUEEN 2.0 — The Evolution Chamber

**Every fix must survive its own attack.**

Phase 0 foundation for a self-improving AI agent harness, built with Next.js App Router, TypeScript, Tailwind CSS, the MongoDB Node.js driver, and Zod.

## Run locally

Use Node.js 22 or later. Install dependencies with `npm ci`. Copy `.env.example` to `.env.local` only if no environment file already exists. Set `MONGODB_URI` to the official MongoDB Atlas hackathon Sandbox URI. Optionally set `MONGODB_DB` (defaults to `red_queen`).

```sh
npm run dev
npm run build
npm run check:mongodb
```

The build uses webpack because Turbopack worker ports are restricted in the local development sandbox. The lockfile pins dependencies. No remote fonts or image services are required.

## What exists

- Responsive chamber, static conceptual genome, disabled BEGIN EVOLUTION control.
- Real browser-requested Atlas status from `GET /api/health`, checked once per mount.
- Server-only reusable connection pool with bounded timeouts and retry after initial connection failure.
- Uncached health endpoint returning HTTP 200 for a successful authenticated ping or 503 for unavailable configuration/connectivity. Raw driver errors and credentials are never returned.
- Versioned, discriminated Zod event contracts for execution, faults, policy proposals, bounded verification, counterexamples, and promotion; TypeScript types are inferred from schemas.
- Strict declarative recovery-policy schema. No generated code is executed.

## Scope and limits

The simulator, policy proposer, verifier, event stream, persistence writes, and promotion logic are **not implemented**. The genome is an illustration, not telemetry. Event validation alone does not establish verification or promotion correctness. Future promotion logic must require a real passing verification result for the same policy and declared bounds.

`check:mongodb` performs an authenticated ping and closes the connection; it writes no data. A successful ping confirms connectivity, not collection-write permissions or whether the cluster was provisioned by the official hackathon Sandbox. Confirm that provenance in Atlas.

## Preview deployment

Deploy to Vercel's preview environment. Set `MONGODB_URI` as a sensitive server environment variable and optionally `MONGODB_DB`; never use `NEXT_PUBLIC_` for secrets. `.env*` files are excluded from Git and deployment uploads, except the placeholder `.env.example`. Existing environment files must be preserved.

The health route fails closed with a generic unavailable response when the database cannot be reached. A deployed landing page can work independently of Atlas; an available engine must never be inferred from database health.
