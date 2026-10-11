"use client";

import { AtlasStatus } from "@/components/atlas-status";
import { EvolutionControl, EvolutionResults, useEvolution } from "@/components/evolution";
import { Genome } from "@/components/genome";

export default function Home() {
  const evolution = useEvolution();
  const promoted = evolution.events.some(e => e.type === "policy.promoted");
  const currentPolicy = evolution.events.filter(e => e.type === "policy.proposed").at(-1);
  const currentVerdict = currentPolicy && evolution.events.find(e => e.type === "verification.completed" && e.payload.policyId === currentPolicy.payload.policy.id);
  const genomeStatus = !currentPolicy ? "idle" : promoted ? "promoted" : currentVerdict?.type === "verification.completed" ? "rejected" : "verifying";
  return (
    <main className="chamber">
      <header className="masthead">
        <a href="/" className="wordmark" aria-label="Red Queen home"><span className="brand-symbol">♛</span> RED QUEEN <span className="version">2.0</span></a>
        <div className="masthead-right"><span className="mono phase-label">PAYMENT RECOVERY / LIVE ENGINE</span><AtlasStatus /></div>
      </header>

      <section className="laboratory" aria-labelledby="chamber-heading">
        <div className="intro">
          <p className="eyebrow"><span /> AN EXPERIMENT IN ADAPTATION</p>
          <h1 id="chamber-heading">THE EVOLUTION<br /><em>CHAMBER</em></h1>
          <p className="tagline">Every fix must survive<br />its own attack.</p>
          <p className="description">A self-improving AI agent harness.<br />Propose a recovery policy. Search for its breaking point.<br className="desktop-break" /> Promote only what survives bounded verification.</p>
          <EvolutionControl state={evolution} />
        </div>

        <div className={`specimen ${evolution.busy ? "executing" : ""}`}>
          <div className="specimen-top mono"><span>RECOVERY GENOME</span><span className="standby">{evolution.busy ? "VERIFYING" : promoted ? "POLICY PROMOTED" : "READY"}</span></div>
          <Genome state={{ policy: currentPolicy?.payload.policy, status: genomeStatus }} />
          <div className="specimen-bottom mono"><span>{currentPolicy ? currentPolicy.payload.policy.name.toUpperCase() : "CONCEPTUAL STRUCTURE / AWAITING RUN"}</span><span>RQ—{currentPolicy ? String(currentPolicy.payload.policy.version).padStart(2, "0") : "00"}</span></div>
        </div>

        <aside className="chamber-rail" aria-label="Chamber state"><span className="rail-cross">+</span><span>{evolution.busy ? "EXPERIMENT IN PROGRESS" : promoted ? "BOUNDED VERIFICATION COMPLETE" : "AWAITING EXPERIMENT"}</span><span className="rail-cross">+</span></aside>
      </section>

      <EvolutionResults state={evolution} />

      <section className="protocol" aria-labelledby="protocol-title">
        <div className="protocol-intro"><p className="eyebrow" id="protocol-title">THE EVOLUTION PROTOCOL</p><p>Designed to improve.<br /><span>Required to prove.</span></p><span className="mono planned">AI PROPOSAL / BOUNDED VERIFICATION / LABELED FALLBACK</span></div>
        <ol>
          <li><span className="step-number">01</span><h2>PROPOSE</h2><p>Counterexamples guide a structured<br />recovery policy.</p></li>
          <li><span className="step-number">02</span><h2>ATTACK</h2><p>Controlled failures search<br />for counterexamples.</p></li>
          <li><span className="step-number">03</span><h2>VERIFY</h2><p>Deterministic checks evaluate<br />explicit, bounded scenarios.</p></li>
          <li><span className="step-number">04</span><h2>EVOLVE</h2><p>Passing policies advance.<br />Failures become memory.</p></li>
        </ol>
      </section>

      <footer><span className="footer-manifesto">NOTHING ADVANCES UNCHALLENGED.</span><span>BUILT FOR MONGODB <span className="footer-dot">/</span> SF TECH WEEK 2026</span><a href="https://github.com/vincentleg/red-queen" target="_blank" rel="noreferrer">SOURCE ↗</a></footer>
    </main>
  );
}
