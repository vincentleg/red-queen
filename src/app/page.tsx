import { AtlasStatus } from "@/components/atlas-status";
import { Genome } from "@/components/genome";

export default function Home() {
  return (
    <main className="chamber">
      <header className="masthead">
        <a href="/" className="wordmark" aria-label="Red Queen home"><span className="brand-symbol">♛</span> RED QUEEN <span className="version">2.0</span></a>
        <div className="masthead-right"><span className="mono phase-label">PHASE 00 / FOUNDATION</span><AtlasStatus /></div>
      </header>

      <section className="laboratory" aria-labelledby="chamber-heading">
        <div className="intro">
          <p className="eyebrow"><span /> AN EXPERIMENT IN ADAPTATION</p>
          <h1 id="chamber-heading">THE EVOLUTION<br /><em>CHAMBER</em></h1>
          <p className="tagline">Every fix must survive<br />its own attack.</p>
          <p className="description">A self-improving AI agent harness.<br />Propose a recovery policy. Search for its breaking point.<br className="desktop-break" /> Promote only what survives bounded verification.</p>
          <div className="activation">
            <button disabled aria-describedby="engine-note"><span className="button-icon">↗</span> BEGIN EVOLUTION <span className="button-lock" aria-hidden="true">⊘</span></button>
            <p id="engine-note"><span /> ENGINE OFFLINE <b>·</b> AVAILABLE IN A FUTURE PHASE</p>
          </div>
        </div>

        <div className="specimen">
          <div className="specimen-top mono"><span>RECOVERY GENOME</span><span className="standby">DORMANT</span></div>
          <Genome />
          <div className="specimen-bottom mono"><span>CONCEPTUAL STRUCTURE / NO ACTIVE POLICY</span><span>RQ—00</span></div>
        </div>

        <aside className="chamber-rail" aria-label="Chamber state"><span className="rail-cross">+</span><span>NO EXPERIMENT IN PROGRESS</span><span className="rail-cross">+</span></aside>
      </section>

      <section className="protocol" aria-labelledby="protocol-title">
        <div className="protocol-intro"><p className="eyebrow" id="protocol-title">THE EVOLUTION PROTOCOL</p><p>Designed to improve.<br /><span>Required to prove.</span></p><span className="mono planned">PLANNED ENGINE / NOT YET ACTIVE</span></div>
        <ol>
          <li><span className="step-number">01</span><h2>PROPOSE</h2><p>An AI proposes a structured<br />recovery policy.</p></li>
          <li><span className="step-number">02</span><h2>ATTACK</h2><p>Controlled failures search<br />for counterexamples.</p></li>
          <li><span className="step-number">03</span><h2>VERIFY</h2><p>Deterministic checks evaluate<br />explicit, bounded scenarios.</p></li>
          <li><span className="step-number">04</span><h2>EVOLVE</h2><p>Passing policies advance.<br />Failures become memory.</p></li>
        </ol>
      </section>

      <footer><span className="footer-manifesto">NOTHING ADVANCES UNCHALLENGED.</span><span>BUILT FOR MONGODB <span className="footer-dot">/</span> SF TECH WEEK 2026</span><a href="https://github.com/vincentleg/red-queen" target="_blank" rel="noreferrer">SOURCE ↗</a></footer>
    </main>
  );
}
