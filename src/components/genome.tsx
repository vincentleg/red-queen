import type { PaymentPolicy } from "@/lib/engine/policy";

// Gene loci are driven by the actual policy under verification: retry bound, reconciliation, idempotency.
// Without a policy it is a static illustration.
export type GenomeState = { policy?: PaymentPolicy; status: "idle" | "baseline" | "mutating" | "verifying" | "verified" | "rejected" | "promoted" };
const LOCI = [{ from: 4, to: 13, label: "RETRY" }, { from: 17, to: 26, label: "RECONCILE" }, { from: 30, to: 39, label: "IDEMPOTENCY" }];
export function Genome({ state = { status: "idle" } }: { state?: GenomeState }) {
  const { policy, status } = state;
  const lit = (i: number) => {
    if (!policy) return true;
    const locus = LOCI.findIndex(l => i >= l.from && i <= l.to);
    if (locus === 0) return i - LOCI[0].from < Math.round(((policy.maxRetries + 1) / 3) * 10);
    if (locus === 1) return policy.reconcileBeforeRetry;
    if (locus === 2) return policy.idempotency === "stable";
    return true;
  };
  const hot = status === "promoted" ? "#9ed2b9" : status === "rejected" ? "#ff4d6a" : "#ff98a4";
  const rung = "#c33750";
  const points = Array.from({ length: 43 }, (_, i) => {
    const angle = i * 0.245;
    return { y: 68 + i * 10.8, a: 300 + Math.sin(angle) * 87, b: 300 - Math.sin(angle) * 87, depth: Math.cos(angle) };
  });
  const strand = (key: "a" | "b") => points.map((p, i) => `${i ? "L" : "M"}${p[key]},${p.y}`).join(" ");
  return (
    <svg className={`genome genome-${status}`} viewBox="0 0 600 610" role="img" aria-labelledby="genome-title">
      <title id="genome-title">Recovery-policy genome. Lit gene bands show the actual policy under verification: retry bound, reconciliation and idempotency.</title>
      <defs>
        <radialGradient id="aura"><stop stopColor="#ec2448" stopOpacity=".18" /><stop offset="1" stopColor="#ec2448" stopOpacity="0" /></radialGradient>
        <linearGradient id="strand" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#62172d" /><stop offset=".45" stopColor="#ff6476" /><stop offset="1" stopColor="#69152b" /></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <ellipse cx="300" cy="309" rx="244" ry="275" fill="url(#aura)" />
      <g fill="none" stroke="#723443" strokeWidth=".7">
        <ellipse cx="300" cy="313" rx="217" ry="241" opacity=".24" />
        <ellipse cx="300" cy="313" rx="244" ry="94" transform="rotate(-29 300 313)" opacity=".32" />
        <ellipse cx="300" cy="313" rx="230" ry="81" transform="rotate(32 300 313)" opacity=".2" />
        <path d="M300 29V49 M300 556V576 M38 313H58 M542 313H562" />
        <path d="M300 62V550" strokeDasharray="2 7" opacity=".3" />
      </g>
      <g stroke="#f13756" opacity=".55" filter="url(#glow)" fill="none" strokeWidth="5"><path d={strand("a")} /><path d={strand("b")} /></g>
      {points.map((p, i) => <g key={i} opacity={(0.35 + Math.abs(p.depth) * 0.55) * (lit(i) ? 1 : 0.18)} style={{ transition: "opacity .6s" }}>
        <line x1={p.a} x2={p.b} y1={p.y} y2={p.y} stroke={rung} strokeWidth={lit(i) && policy ? 1.6 : 1} strokeDasharray={lit(i) ? undefined : "2 4"} />
        <circle cx={p.a} cy={p.y} r={p.depth > 0 ? 3 : 2} fill={p.depth > 0 ? hot : "#8b2842"} />
        <circle cx={p.b} cy={p.y} r={p.depth < 0 ? 3 : 2} fill={p.depth < 0 ? hot : "#8b2842"} />
      </g>)}
      {policy && <g fill="#a58088" fontSize="7" fontFamily="monospace" letterSpacing="1.2">{LOCI.map((l, k) =>
        <text key={l.label} x="548" y={points[l.from].y + 4} textAnchor="end">{l.label} {k === 0 ? `×${policy.maxRetries}` : k === 1 ? (policy.reconcileBeforeRetry ? "ON" : "OFF") : policy.idempotency.toUpperCase()}</text>)}</g>}
      <g stroke="url(#strand)" strokeWidth="1.5" fill="none"><path d={strand("a")} /><path d={strand("b")} /></g>
      {status === 'verifying' && <rect className="genome-scan" x="195" y="65" width="210" height="6" rx="3" fill="#ff98a4" opacity=".6" />}
      {status === 'promoted' && <circle cx="300" cy="560" r="5" fill="#9ed2b9" />}
      <g fill="none" stroke="#9d5360" strokeWidth=".6"><path d="M358 187H451L472 166H533" /><circle cx="358" cy="187" r="5" /><path d="M227 409H140L121 428H66" /><circle cx="227" cy="409" r="5" /></g>
      <g fill="#a58088" fontSize="8" fontFamily="monospace" letterSpacing="1.4"><text x="453" y="155">{policy ? `GENERATION ${String(policy.version).padStart(2, "0")}` : "POLICY STRUCTURE"}</text><text x="49" y="447">{policy ? status.toUpperCase() : "AWAITING SEED"}</text></g>
    </svg>
  );
}
