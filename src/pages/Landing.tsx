import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowRight, GitMerge, Layers, Radar, SlidersHorizontal, Target } from "lucide-react";
import { Link } from "react-router";

const STEPS = [
  { n: "01", label: "Generate", text: "Seed a fixed, internally consistent alert dataset across 70 microservices." },
  { n: "02", label: "Normalize & dedupe", text: "Fingerprint every event and collapse identical repeat firings." },
  { n: "03", label: "Correlate", text: "Group by dependency distance, time window, alert type and cascade shape." },
  { n: "04", label: "Explain", text: "Rank root causes from evidence, then narrate them as hypotheses." },
  { n: "05", label: "Evaluate", text: "Score the engine against labelled ground truth vs a naive baseline." },
];

const PILLARS = [
  {
    icon: Radar,
    title: "Signal triage, not a wall of red",
    text: "Every alert is scored and labelled act now, review, or safe to ignore — so the on-call engineer knows which page is worth breaking silence for.",
  },
  {
    icon: GitMerge,
    title: "Every grouping is inspectable",
    text: "Open an alert and see the rules that joined it to an incident, or the gate that kept it out. No black-box clustering.",
  },
  {
    icon: Target,
    title: "Measured, not asserted",
    text: "Precision, recall, root-cause accuracy and execution time are recomputed from the loaded dataset on every run.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center border border-border text-[11px] font-semibold">
              IC
            </span>
            <span className="text-[13px] font-medium tracking-tight">Incident Control</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:inline">
              simulated data · hackathon build
            </span>
            <Link to="/auth">
              <Button size="sm" className="h-8 gap-1.5 px-3 text-xs">
                Open console <ArrowRight className="size-3.5" strokeWidth={1.8} />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="grid gap-10 border-b border-border/70 py-16 lg:grid-cols-[1.15fr_1fr] lg:py-20"
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              AI alert correlation &amp; incident detection
            </p>
            <h1 className="mt-5 max-w-xl text-4xl font-medium leading-[1.08] tracking-tight sm:text-5xl">
              Hundreds of alerts.
              <span className="block text-muted-foreground">A handful that matter.</span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-muted-foreground">
              The correlation engine collapses duplicate and related alerts into a small number of
              incidents, ranks probable root causes from the dependency graph, and shows its
              reasoning for every decision. Alerts you can ignore are labelled as such.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/auth?returnTo=%2Fdashboard">
                <Button className="h-9 gap-1.5 px-4 text-sm">
                  Start investigating <ArrowRight className="size-4" strokeWidth={1.8} />
                </Button>
              </Link>
              <Link to="/auth?returnTo=%2Fdashboard%2Falerts">
                <Button variant="outline" className="h-9 px-4 text-sm">
                  Jump to live alerts
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">
              All data is synthetic and clearly labelled. No production monitoring is connected.
            </p>
          </div>

          {/* Workflow preview */}
          <div className="border border-border/70 bg-card p-5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              what the console does
            </p>
            <ol className="mt-4 divide-y divide-border/60">
              {STEPS.map((step) => (
                <li key={step.n} className="flex gap-4 py-3">
                  <span className="tnum text-[11px] text-muted-foreground">{step.n}</span>
                  <div>
                    <p className="text-[13px] text-foreground">{step.label}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-4">
              {[
                { k: "act now", tone: "sev-critical" },
                { k: "review", tone: "sev-warning" },
                { k: "safe to ignore", tone: "sev-muted" },
              ].map((item) => (
                <div key={item.k} className="border border-border/70 px-2.5 py-2">
                  <p className={`text-[10px] uppercase tracking-[0.1em] ${item.tone}`}>{item.k}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    per-alert classification
                  </p>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Pillars */}
        <section className="grid gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="bg-background px-5 py-8">
              <pillar.icon className="size-4 text-muted-foreground" strokeWidth={1.6} />
              <h2 className="mt-3 text-[15px] font-medium tracking-tight">{pillar.title}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{pillar.text}</p>
            </div>
          ))}
        </section>

        {/* Detail columns */}
        <section className="grid gap-10 border-b border-border/70 py-14 lg:grid-cols-3">
          {[
            {
              icon: Layers,
              title: "Built for investigation",
              items: [
                "Search, sort and filter 400–900 synthetic alerts",
                "Expand any alert for fingerprint, dedupe and correlation rules",
                "Incident view with timeline, evidence, candidates and status controls",
              ],
            },
            {
              icon: SlidersHorizontal,
              title: "Configurable engine",
              items: [
                "Correlation and dedupe windows adjustable from the dashboard",
                "Deterministic engine — the same seed reproduces the same run",
                "AI explanations fall back to a deterministic writer when no model is reachable",
              ],
            },
            {
              icon: GitMerge,
              title: "Honest evaluation",
              items: [
                "Baseline: one incident per unique alert",
                "Overlap-based matching (Jaccard ≥ 0.5) against labelled groups",
                "Held-out dataset toggle so results generalise beyond one seed",
              ],
            },
          ].map((column) => (
            <div key={column.title}>
              <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <column.icon className="size-3.5" strokeWidth={1.6} />
                {column.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {column.items.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/85">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* CTA */}
        <section className="flex flex-col items-start gap-4 py-14 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-medium tracking-tight">Run the demo end to end</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Generate alerts → run analysis → investigate the cascading failure → read the metrics.
            </p>
          </div>
          <Link to="/auth?returnTo=%2Fdashboard">
            <Button className="h-9 gap-1.5 px-4 text-sm">
              Open the console <ArrowRight className="size-4" strokeWidth={1.8} />
            </Button>
          </Link>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-[11px] text-muted-foreground sm:flex-row sm:justify-between">
          <p>Incident Control — AI alert correlation &amp; incident detection platform.</p>
          <p>
            Synthetic dataset, deterministic engine. Ground-truth labels are used only for
            evaluation.
          </p>
        </div>
      </footer>
    </div>
  );
}
