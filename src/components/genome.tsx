// A static structural illustration, never presented as an executed policy.
export function Genome() {
  const points = Array.from({ length: 43 }, (_, i) => {
    const angle = i * 0.245;
    return { y: 68 + i * 10.8, a: 300 + Math.sin(angle) * 87, b: 300 - Math.sin(angle) * 87, depth: Math.cos(angle) };
  });
  const strand = (key: "a" | "b") => points.map((p, i) => `${i ? "L" : "M"}${p[key]},${p.y}`).join(" ");
  return (
    <svg className="genome" viewBox="0 0 600 610" role="img" aria-labelledby="genome-title">
      <title id="genome-title">Conceptual recovery-policy genome. The adjacent labels show actual engine state; this structure is an illustration.</title>
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
      {points.map((p, i) => <g key={i} opacity={0.35 + Math.abs(p.depth) * 0.55}>
        <line x1={p.a} x2={p.b} y1={p.y} y2={p.y} stroke="#c33750" strokeWidth="1" />
        <circle cx={p.a} cy={p.y} r={p.depth > 0 ? 3 : 2} fill={p.depth > 0 ? "#ff98a4" : "#8b2842"} />
        <circle cx={p.b} cy={p.y} r={p.depth < 0 ? 3 : 2} fill={p.depth < 0 ? "#ff98a4" : "#8b2842"} />
      </g>)}
      <g stroke="url(#strand)" strokeWidth="1.5" fill="none"><path d={strand("a")} /><path d={strand("b")} /></g>
      <g fill="none" stroke="#9d5360" strokeWidth=".6"><path d="M358 187H451L472 166H533" /><circle cx="358" cy="187" r="5" /><path d="M227 409H140L121 428H66" /><circle cx="227" cy="409" r="5" /></g>
      <g fill="#a58088" fontSize="8" fontFamily="monospace" letterSpacing="1.4"><text x="453" y="155">POLICY STRUCTURE</text><text x="49" y="447">AWAITING SEED</text></g>
    </svg>
  );
}
