import {
  AttentionBadge,
  SectionCard,
  SeverityBadge,
  StatusBadge,
  severityDot,
} from "@/components/bits";
import { CorrelationEvidence, IncidentExplanation } from "@/components/IncidentExplanation";
import { DependencyGraph, type NodeState } from "@/components/DependencyGraph";
import { Button } from "@/components/ui/button";
import { fmtClock, fmtDateTime, fmtValue, num, pct } from "@/lib/format";
import { SERVICE_MAP, ancestors, descendants, EDGES } from "@/lib/engine/services";
import { useStore } from "@/lib/store";
import { ArrowLeft, CheckCircle2, Clock, RotateCcw, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

export function IncidentDetailPage() {
  const { incidentId } = useParams();
  const { incidentById, incidents, scopedAlerts, analysis, setStatus } = useStore();
  const [selectedService, setSelectedService] = useState<string | null>(null);

  const incident = incidentId ? incidentById(incidentId) : undefined;

  const alerts = useMemo(() => {
    if (!incident) return [];
    const ids = new Set(incident.alertIds);
    return scopedAlerts.filter((a) => ids.has(a.id)).sort((a, b) => a.ts - b.ts);
  }, [incident, scopedAlerts]);

  const duplicates = useMemo(() => {
    if (!incident) return [];
    const ids = new Set(incident.duplicateIds);
    return scopedAlerts.filter((a) => ids.has(a.id)).sort((a, b) => a.ts - b.ts);
  }, [incident, scopedAlerts]);

  const focusServices = useMemo(() => {
    if (!incident) return [];
    const ids = new Set<string>(incident.services);
    for (const s of incident.services) {
      for (const dep of SERVICE_MAP[s]?.deps ?? []) ids.add(dep);
      for (const child of SERVICE_MAP[s]?.deps ?? []) ids.add(child);
    }
    for (const dep of SERVICE_MAP[incident.probableRootCause]?.deps ?? []) ids.add(dep);
    for (const child of ancestors(incident.probableRootCause, 2)) ids.add(child);
    for (const d of descendants(incident.probableRootCause, 2)) ids.add(d);
    return [...ids]
      .map((id) => SERVICE_MAP[id])
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
  }, [incident]);

  const states = useMemo(() => {
    const map: Record<string, NodeState> = {};
    if (!incident) return map;
    for (const service of focusServices) map[service.id] = "muted";
    for (const s of incident.services) map[s] = "affected";
    map[incident.probableRootCause] = "root";
    if (selectedService) map[selectedService] = "selected";
    return map;
  }, [incident, focusServices, selectedService]);

  const highlightedEdges = useMemo(() => {
    if (!incident) return 0;
    const set = new Set(incident.services);
    return EDGES.filter((e) => set.has(e.from) && set.has(e.to)).length;
  }, [incident]);

  if (!incident) {
    return (
      <div className="space-y-4">
        <Link to="/dashboard/incidents" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to incidents
        </Link>
        <SectionCard title="Incident not found" description="The incident id in the URL is not part of the current analysis run.">
          <Link to="/dashboard/incidents">
            <Button size="sm" variant="outline">Return to incident register</Button>
          </Link>
        </SectionCard>
      </div>
    );
  }

  const duration = incident.lastTs - incident.startTs;
  const rootCandidate = incident.rootCauses[0];
  const maxScore = incident.rootCauses[0]?.score || 1;
  const selected = selectedService ? SERVICE_MAP[selectedService] : undefined;
  const selectedAlerts = selectedService
    ? alerts.filter((a) => a.service === selectedService)
    : [];

  const statusActions = () => {
    const common = "h-7 gap-1.5 px-2.5 text-[11px]";
    return (
      <div className="flex flex-wrap items-center gap-2">
        {incident.status !== "acknowledged" && incident.status !== "resolved" && (
          <Button size="sm" variant="outline" className={common} onClick={() => setStatus(incident.id, "acknowledged")}>
            <Clock className="size-3.5" strokeWidth={1.7} /> Acknowledge
          </Button>
        )}
        {incident.status !== "resolved" && (
          <Button size="sm" className={common} onClick={() => setStatus(incident.id, "resolved")}>
            <CheckCircle2 className="size-3.5" strokeWidth={1.7} /> Resolve
          </Button>
        )}
        {incident.status === "resolved" && (
          <Button size="sm" variant="outline" className={common} onClick={() => setStatus(incident.id, "open")}>
            <RotateCcw className="size-3.5" strokeWidth={1.7} /> Reopen
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/dashboard/incidents"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Incident register
        </Link>
        <div className="tnum text-[11px] text-muted-foreground">
          {incidents.length} incidents in this run · analysis {analysis.durationMs}ms
        </div>
      </div>

      {/* Header */}
      <header className="border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="tnum text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {incident.id}
              </span>
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
              <span className="text-[11px] text-muted-foreground">
                {incident.environments.join(", ")}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-medium tracking-tight text-foreground">
              {incident.title}
            </h2>
            <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="size-2 rounded-full"
                style={{ background: severityDot(incident.severity) }}
              />
              Started {fmtDateTime(incident.startTs)} · last seen {fmtClock(incident.lastTs)} ·
              duration {Math.round(duration / 1000)}s
            </p>
          </div>
          {statusActions()}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { k: "Alerts", v: num(incident.alertCount) },
            { k: "Suppressed duplicates", v: num(incident.suppressedCount) },
            { k: "Affected services", v: num(incident.services.length) },
            { k: "Scope", v: incident.services.length > 1 ? "cascade" : "isolated" },
            { k: "Noise share", v: pct(1 - incident.alertCount / Math.max(1, analysis.uniqueAlertCount)) },
            { k: "Correlation rules", v: num(incident.evidence.length) },
          ].map((row) => (
            <div key={row.k}>
              <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{row.k}</dt>
              <dd className="tnum mt-1 text-lg font-medium leading-none">{row.v}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* Root cause ranking + evidence */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Probable root cause"
          description="Ranked from dependency position, event ordering, severity and propagation consistency"
          actions={
            <span className="tnum text-[11px] text-muted-foreground">
              {incident.rootCauses.length} candidates
            </span>
          }
        >
          {rootCandidate && (
            <div className="mb-4 border border-[var(--sev-critical)]/40 bg-[oklch(0.655_0.205_25.5_/_6%)] px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.12em] sev-critical">
                  Top candidate · hypothesis
                </p>
                <p className="tnum text-[11px] text-muted-foreground">
                  score {rootCandidate.score} / {maxScore}
                </p>
              </div>
              <p className="mt-1.5 text-lg font-medium tracking-tight">
                {SERVICE_MAP[rootCandidate.service]?.name ?? rootCandidate.service}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {SERVICE_MAP[rootCandidate.service]?.domain} · owner{" "}
                {SERVICE_MAP[rootCandidate.service]?.owner}
              </p>
              <ul className="mt-2.5 space-y-1">
                {rootCandidate.signals.map((signal, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-snug text-foreground/90">
                    <span className="tnum mt-0.5 shrink-0 text-[11px] text-muted-foreground">
                      +{signal.points}
                    </span>
                    <span>
                      <span className="text-foreground">{signal.label}</span> — {signal.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mb-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Ranked alternatives
          </p>
          <ul className="space-y-3">
            {incident.rootCauses.slice(1, 5).map((candidate) => (
              <li key={candidate.service}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-foreground">
                    {SERVICE_MAP[candidate.service]?.name ?? candidate.service}
                  </span>
                  <span className="tnum text-[11px] text-muted-foreground">
                    {candidate.score} pts · {pct(candidate.score / maxScore, 0)} of top
                  </span>
                </div>
                <div className="mt-1 h-1 w-full bg-muted/60">
                  <div
                    className="h-full bg-[var(--sev-info)]"
                    style={{ width: `${(candidate.score / maxScore) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  {candidate.signals[0]?.label}: {candidate.signals[0]?.detail}
                </p>
              </li>
            ))}
            {incident.rootCauses.length === 1 && (
              <li className="text-xs text-muted-foreground">
                Only one candidate exists for an isolated incident — there is nothing to displace it.
              </li>
            )}
          </ul>
        </SectionCard>

        <CorrelationEvidence incidentId={incident.id} />
      </div>

      <IncidentExplanation incidentId={incident.id} />

      {/* Dependency visualization */}
      <SectionCard
        title="Dependency context"
        description="Red node: top root-cause candidate · amber nodes: services that fired · grey: dependency context"
        actions={
          <Link
            to="/dashboard/services"
            className="text-[11px] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
          >
            Open full service map
          </Link>
        }
        bodyClassName="p-3 sm:p-4"
      >
        <DependencyGraph
          services={focusServices}
          states={states}
          selected={selectedService}
          onSelect={(id) => setSelectedService((prev) => (prev === id ? null : id))}
          edgeMode="highlight"
        />
        {selected ? (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border border-border/70 px-3 py-2.5">
            <div>
              <p className="text-[13px] text-foreground">
                {selected.name}{" "}
                <span className="text-[11px] text-muted-foreground">
                  ({selected.domain} · {selected.language} · {selected.owner})
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Calls: {selected.deps.length ? selected.deps.map((d) => SERVICE_MAP[d]?.name ?? d).join(", ") : "nothing (leaf dependency)"}
              </p>
              <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
                {selectedAlerts.length} alert{selectedAlerts.length === 1 ? "" : "s"} in this incident
                {incident.services.includes(selected.id) ? " · affected" : " · dependency context"}
              </p>
            </div>
            <div className="flex gap-2">
              {selectedAlerts.slice(0, 3).map((a) => (
                <span key={a.id} className="tnum border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
                  {fmtClock(a.ts)} {a.type.replace(/_/g, " ")}
                </span>
              ))}
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSelectedService(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Click a node to inspect the service and its alerts in this incident.{" "}
            {highlightedEdges} edges connect services that fired.
          </p>
        )}
      </SectionCard>

      {/* Timeline + alerts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Incident timeline" description="Chronological, seconds relative to first alert">
          <ol className="relative space-y-3 border-l border-border/60 pl-4">
            {incident.timeline.map((event, i) => (
              <li key={i} className="relative">
                <span
                  className="absolute -left-[21px] top-1 size-2 rounded-full border border-background"
                  style={{
                    background: event.severity ? severityDot(event.severity) : "var(--sev-muted)",
                  }}
                />
                <p className="tnum text-[11px] text-muted-foreground">
                  {fmtClock(event.ts)} · T+{Math.round((event.ts - incident.startTs) / 1000)}s
                  {event.service ? ` · ${SERVICE_MAP[event.service]?.name ?? event.service}` : ""}
                </p>
                <p
                  className={`text-[12px] leading-snug ${
                    event.kind === "duplicate" ? "text-muted-foreground italic" : "text-foreground/90"
                  }`}
                >
                  {event.text}
                </p>
              </li>
            ))}
          </ol>
        </SectionCard>

        <SectionCard
          className="lg:col-span-2"
          bodyClassName="p-0"
          title="Related alerts"
          description={`${alerts.length} correlated alerts, ordered by time`}
        >
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-4 py-2 font-normal">Time</th>
                  <th className="px-3 py-2 font-normal">Signal</th>
                  <th className="px-3 py-2 font-normal">Service</th>
                  <th className="px-3 py-2 font-normal">Alert</th>
                  <th className="px-3 py-2 font-normal">Observed</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => {
                  const decision = analysis.decisions[a.id];
                  return (
                    <tr key={a.id} className="border-b border-border/40 align-top">
                      <td className="tnum px-4 py-2.5 text-xs text-muted-foreground">{fmtClock(a.ts)}</td>
                      <td className="px-3 py-2.5">
                        {decision ? <AttentionBadge attention={decision.attention} /> : null}
                      </td>
                      <td className="px-3 py-2.5 text-[13px]">{SERVICE_MAP[a.service]?.name ?? a.service}</td>
                      <td className="px-3 py-2.5">
                        <p className="text-[12px] text-foreground/90">{a.description}</p>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {a.type.replace(/_/g, " ")} · {a.source}
                        </p>
                      </td>
                      <td className="tnum px-3 py-2.5 text-xs text-muted-foreground">
                        {fmtValue(a.value, a.unit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Suppressed duplicates */}
      <SectionCard
        title="Suppressed duplicate alerts"
        description={`${duplicates.length} repeat firings collapsed before correlation — visible but not counted as separate signals`}
        actions={<ShieldAlert className="size-4 text-muted-foreground" strokeWidth={1.6} />}
        bodyClassName="p-0"
      >
        {duplicates.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            No duplicates were suppressed for this incident.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {duplicates.map((a) => {
              const decision = analysis.decisions[a.id];
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className="tnum text-xs text-muted-foreground">{fmtClock(a.ts)}</span>
                  <span className="text-[13px]">{SERVICE_MAP[a.service]?.name ?? a.service}</span>
                  <span className="text-[12px] text-muted-foreground">{a.description}</span>
                  <span className="tnum ml-auto text-[11px] text-muted-foreground">
                    {decision?.duplicateOf ? `repeat of ${decision.duplicateOf}` : "duplicate"}
                    {a.ingestDelayMs ? ` · arrived ${Math.round(a.ingestDelayMs / 1000)}s late` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
