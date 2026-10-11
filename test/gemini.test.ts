import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposer, GEMINI_MODEL, ProposerError, type ProposalContext } from '../src/lib/engine/proposer.ts';
import { baseline } from '../src/lib/engine/policy.ts';

const context: ProposalContext = { generation: 2, attempt: 1, currentPolicy: baseline('00000000-0000-4000-8000-000000000001'),
  counterexamples: [], history: [], rejected: [] };

test('Gemini is preferred when configured; absent credentials preserve fallback', () => {
  assert.equal(createProposer({}), null);
  const p = createProposer({ GEMINI_API_KEY: 'test-only', ANTHROPIC_API_KEY: 'test-only' });
  assert.equal(p?.provider, 'google');
  assert.equal(p?.model, GEMINI_MODEL);
});

test('Gemini quota failures expose only status, without retrying or leaking response bodies', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('sensitive provider details', { status: 429 });
  });
  await assert.rejects(createProposer({ GEMINI_API_KEY: 'test-only' })!.propose(context),
    (e: unknown) => e instanceof ProposerError && e.category === 'model_error' && e.detail === 'Provider returned HTTP 429');
  assert.equal(calls, 1);
});

test('truncated Gemini JSON never becomes an accepted proposal', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS',
    content: { parts: [{ text: '{' }] } }] }));
  assert.deepEqual(await createProposer({ GEMINI_API_KEY: 'test-only' })!.propose(context),
    { output: null, stopReason: 'max_tokens' });
});
