import { SectionCard, SeverityBadge, StatusBadge, severityDot } from "@/components/bits";
import { IncidentExplanation } from "@/components/IncidentExplanation";
import { Button } from "@/components/ui/button";
import { fmtClock, num, pct } from "@/lib/format";
import { SERVICE_MAP } from "@/lib/engine/services";
import { useStore } from "@/lib/store";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

export function RootCausePage() {
  const { incidents, analysis, evaluation, scopedAlerts } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);

  const ranked = useMemo(() => {
    const list = openOnly ? incidents.filter((i) => i.status !== "resolved") : incidents;
    return [...list].sort((a, b) => {
      const order = { critical: 4, high: 3, medium: 2, low: 1 } as const;
      return order[b.severity] - order[a.severity] || b.alertCount - a.alertCount;
    });
  }, [incidents, openOnly]);

  useEffect(() => {
    if (!ranked.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !ranked.some((i) => i.id === selectedId)) {
      setSelectedId(ranked[0].id);
    }
  }, [ranked, selectedId]);

  const selected = incidents.find((i) => i.id === selectedId);
  const serviceCount = new Set(scopedAlerts.map((a) => a.service)).size;

  return (
    <div className="space-y-4">
      <section className="border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-sm font-medium tracking-tight">Root-cause analysis</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Every incident gets a ranked set of candidate causes computed from dependency-graph
              position, event ordering, downstream reach, severity and propagation consistency. The
              model only writes the narrative — it reads the same evidence, cannot merge incidents,
              and cannot add alerts. Conclusions are labelled hypotheses, never facts.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-right sm:grid-cols-3">
            <Stat label="Incidents analysed" value={num(incidents.length)} />
            <Stat label="Top-1 accuracy" value={pct(evaluation.proposedRootTop1)} />
            <Stat label="Services in scope" value={num(serviceCount)} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 sm:grid-cols-4">
          <MethodStep n="1" title="Collect" text="Alerts grouped into incidents by the correlation engine." />
          <MethodStep n="2" title="Score" text="Each candidate service earns points on five signals." />
          <MethodStep n="3" title="Rank" text="Candidates are ordered; first is the probable root cause." />
          <MethodStep n="4" title="Explain" text="A model narrates the ranking, or the deterministic writer does." />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <SectionCard
          bodyClassName="p-0"
          title="Incident queue"
          description={`${ranked.length} incidents`}
          actions={
            <Button
              size="sm"
              variant={openOnly ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setOpenOnly((v) => !v)}
            >
              {openOnly ? "Open only" : "All statuses"}
            </Button>
          }
        >
          <ul className="max-h-[560px] divide-y divide-border/50 overflow-auto">
            {ranked.map((incident) => (
              <li key={incident.id}>
                <button
                  onClick={() => setSelectedId(incident.id)}
                  className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors ${
                    selectedId === incident.id ? "bg-accent/50" : "hover:bg-accent/30"
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: severityDot(incident.severity) }} />
                    <span className="tnum text-[11px] text-muted-foreground">{incident.id}</span>
                    <span className="ml-auto">
                      <StatusBadge status={incident.status} />
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[12px] leading-snug text-foreground">
                    {incident.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    root cause: {SERVICE_MAP[incident.probableRootCause]?.name ?? incident.probableRootCause} ·{" "}
                    {incident.alertCount} alerts
                  </span>
                </button>
              </li>
            ))}
            {!ranked.length && (
              <li className="px-4 py-8 text-center text-xs text-muted-foreground">
                No incidents in this run. Generate a dataset and run the analysis first.
              </li>
            )}
          </ul>
        </SectionCard>

        <div className="space-y-4">
          {selected && (
            <SectionCard
              title="Candidate ranking"
              description={`${selected.rootCauses.length} candidate services scored`}
              actions={
                <Link
                  to={`/dashboard/incidents/${selected.id}`}
                  className="text-[11px] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                >
                  Investigate {selected.id} →
                </Link>
              }
            >
              <div className="space-y-3">
                {selected.rootCauses.slice(0, 6).map((candidate, index) => {
                  const max = selected.rootCauses[0].score || 1;
                  const isTop = index === 0;
                  return (
                    <div key={candidate.service} className="border border-border/60 px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-[13px]">
                          <span
                            className={`tnum flex size-4 items-center justify-center border text-[10px] ${
                              isTop ? "border-[var(--sev-critical)] sev-critical" : "border-border text-muted-foreground"
                            }`}
                          >
                            {index + 1}
                          </span>
                          {SERVICE_MAP[candidate.service]?.name ?? candidate.service}
                          {isTop && (
                            <span className="text-[10px] uppercase tracking-[0.1em] sev-critical">
                              probable root cause
                            </span>
                          )}
                        </span>
                        <span className="tnum text-[11px] text-muted-foreground">
                          {candidate.score} pts · {pct(candidate.score / max, 0)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full bg-muted/60">
                        <div
                          className={`h-full ${isTop ? "bg-[var(--sev-critical)]" : "bg-[var(--sev-info)]"}`}
                          style={{ width: `${(candidate.score / max) * 100}%` }}
                        />
                      </div>
                      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                        {candidate.signals.map((signal, i) => (
                          <li key={i} className="text-[11px] leading-snug text-muted-foreground">
                            <span className="tnum text-foreground/80">+{signal.points}</span>{" "}
                            {signal.label}: {signal.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {selected && <IncidentExplanation incidentId={selected.id} />}

          {selected && (
            <SectionCard title="Evidence used for this incident" description="Correlation rules only — no model output">
              <ul className="space-y-1.5">
                {selected.evidence.map((line, i) => (
                  <li key={i} className="text-[12px] text-foreground/90">
                    · {line}
                  </li>
                ))}
              </ul>
              <p className="tnum mt-3 text-[11px] text-muted-foreground">
                Window: {fmtClock(selected.startTs)} → {fmtClock(selected.lastTs)} ·{" "}
                {Math.round((selected.lastTs - selected.startTs) / 1000)}s span ·{" "}
                <SeverityBadge severity={selected.severity} />
              </p>
            </SectionCard>
          )}

          {!selected && (
            <SectionCard title="No incident selected" description="Run the analysis to populate this page">
              <p className="text-xs text-muted-foreground">
                Analysis status: {analysis.rawAlertCount} raw alerts → {analysis.uniqueAlertCount}{" "}
                unique → {incidents.length} incidents in {analysis.durationMs}ms.
              </p>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="tnum mt-1 text-lg font-medium leading-none">{value}</p>
    </div>
  );
}

function MethodStep({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
        <span className="tnum flex size-4 items-center justify-center border border-border text-[10px]">
          {n}
        </span>
        {title}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground/90">{text}</p>
    </div>
  );
}
