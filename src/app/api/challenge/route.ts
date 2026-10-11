import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { challenge, challengeRequestSchema } from '@/lib/engine/challenge';
import { policySchema } from '@/lib/engine/policy';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  const input = challengeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Choose a stored generation and supported attack.' }, { status: 400 });
  try {
    const db = await getDatabase();
    const { runId, attack } = input.data;
    const ids = [...new Set(input.data.policyIds)];
    const policies = await db.collection('policies').find({ runId, 'policy.id': { $in: ids } }).toArray();
    if (policies.length !== ids.length) return NextResponse.json({ error: 'Stored policy not found in this experiment.' }, { status: 404 });
    const results = ids.map(id => challenge(policySchema.parse(policies.find(p => p.policy.id === id)!.policy), attack));
    const challengeId = randomUUID();
    await db.collection('challenges').insertOne({ challengeId, runId, attack, results, createdAt: new Date() });
    return NextResponse.json({ challengeId, results, persisted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Challenge or Atlas persistence unavailable. No stored-result claim.' }, { status: 503 }); }
}
