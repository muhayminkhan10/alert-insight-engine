import { SectionCard, SeverityBadge, StatusBadge, severityDot } from "@/components/bits";
import { DependencyGraph, type NodeState } from "@/components/DependencyGraph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtClock, num } from "@/lib/format";
import { SERVICES, SERVICE_MAP, DEPENDENTS } from "@/lib/engine/services";
import type { Incident } from "@/lib/engine/types";
import { useStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { Link } from "react-router";

type Health = "healthy" | "warning" | "degraded" | "critical";

const HEALTH_LABEL: Record<Health, { label: string; color: string }> = {
  healthy: { label: "healthy", color: "var(--sev-ok)" },
  warning: { label: "degraded", color: "var(--sev-warning)" },
  degraded: { label: "at risk", color: "var(--sev-warning)" },
  critical: { label: "failing", color: "var(--sev-critical)" },
};

export function ServiceMapPage() {
  const { incidents, scopedAlerts, analysis } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [onlyIncidents, setOnlyIncidents] = useState(false);
  const [query, setQuery] = useState("");

  const activeIncidents = useMemo(
    () => incidents.filter((i) => i.status !== "resolved"),
    [incidents],
  );

  const serviceHealth = useMemo(() => {
    const map = new Map<string, { health: Health; incidents: Incident[] }>();
    for (const service of SERVICES) map.set(service.id, { health: "healthy", incidents: [] });
    for (const incident of incidents) {
      const rank = incident.severity === "critical" ? 3 : incident.severity === "high" ? 2 : 1;
      for (const service of incident.services) {
        const entry = map.get(service);
        if (!entry) continue;
        entry.incidents.push(incident);
        if (incident.status === "resolved") continue;
        const current = entry.health === "critical" ? 3 : entry.health === "degraded" ? 2 : entry.health === "warning" ? 1 : 0;
        entry.health = (["healthy", "warning", "degraded", "critical"] as Health[])[Math.max(current, rank)];
      }
    }
    return map;
  }, [incidents]);

  const states = useMemo(() => {
    const map: Record<string, NodeState> = {};
    for (const service of SERVICES) map[service.id] = "healthy";
    for (const [id, entry] of serviceHealth) {
      const active = entry.incidents.filter((i) => i.status !== "resolved");
      if (!active.length) continue;
      // Red is reserved for the engine's leading root-cause candidate.
      map[id] = active.some((i) => i.probableRootCause === id) ? "root" : "affected";
    }
    if (onlyIncidents) {
      for (const [id, state] of Object.entries(map)) {
        if (state === "healthy") map[id] = "muted";
      }
    }
    if (selected) map[selected] = "selected";
    return map;
  }, [serviceHealth, onlyIncidents, selected]);

  const visibleServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SERVICES;
    return SERVICES.filter((s) => s.id.includes(q) || s.name.toLowerCase().includes(q) || s.domain.includes(q));
  }, [query]);

  const selectedService = selected ? SERVICE_MAP[selected] : undefined;
  const selectedEntry = selected ? serviceHealth.get(selected) : undefined;
  const selectedAlerts = selected
    ? scopedAlerts.filter((a) => a.service === selected).sort((a, b) => b.ts - a.ts).slice(0, 8)
    : [];

  const counts = useMemo(() => {
    let degraded = 0;
    let affected = 0;
    for (const entry of serviceHealth.values()) {
      if (entry.health !== "healthy") degraded += 1;
      if (entry.incidents.length) affected += 1;
    }
    return { degraded, affected };
  }, [serviceHealth]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 border border-border/70 bg-card p-4 sm:grid-cols-4 sm:p-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Services</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none">{SERVICES.length}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">With alerts in scope</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none sev-info">
            {num(new Set(scopedAlerts.map((a) => a.service)).size)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">In an active incident</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none sev-warning">{num(counts.affected)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Active incidents</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none">{num(activeIncidents.length)}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <SectionCard
          title="Service dependency map"
          description="Columns are dependency tiers: callers on the left, infrastructure on the right. Arrows point the way calls go — failures travel against them. Click a node for details."
          actions={
            <Button
              size="sm"
              variant={onlyIncidents ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setOnlyIncidents((v) => !v)}
            >
              {onlyIncidents ? "Show all services" : "Focus on incidents"}
            </Button>
          }
          bodyClassName="p-3 sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter services…"
              className="h-8 max-w-[240px] text-xs"
            />
            <Legend color="var(--sev-critical)" label="root-cause candidate" />
            <Legend color="var(--sev-warning)" label="in an active incident" />
            <Legend color="var(--sev-ok)" label="healthy" />
          </div>

          <DependencyGraph
            services={visibleServices}
            states={states}
            selected={selected}
            onSelect={(id) => setSelected((prev) => (prev === id ? null : id))}
          />
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title="Service details"
            description={selectedService ? "Selected node" : "Click a node in the map"}
          >
            {!selectedService ? (
              <p className="text-xs text-muted-foreground">
                Select a service to see its health, dependencies, active incidents and most recent
                alerts.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[15px] font-medium tracking-tight">{selectedService.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedService.domain} · {selectedService.language} · {selectedService.owner}
                  </p>
                  <span
                    className="mt-2 inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] uppercase tracking-[0.1em]"
                    style={{ borderColor: HEALTH_LABEL[selectedEntry!.health].color, color: HEALTH_LABEL[selectedEntry!.health].color }}
                  >
                    {HEALTH_LABEL[selectedEntry!.health].label}
                  </span>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Depends on</p>
                  <p className="mt-1 text-xs text-foreground/90">
                    {selectedService.deps.length
                      ? selectedService.deps.map((d) => SERVICE_MAP[d]?.name ?? d).join(", ")
                      : "leaf dependency"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Called by</p>
                  <p className="mt-1 text-xs text-foreground/90">
                    {(DEPENDENTS[selectedService.id] ?? []).length
                      ? (DEPENDENTS[selectedService.id] ?? []).map((d) => SERVICE_MAP[d]?.name ?? d).join(", ")
                      : "no downstream services"}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                    Incidents ({selectedEntry?.incidents.length ?? 0})
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {(selectedEntry?.incidents ?? []).slice(0, 4).map((incident) => (
                      <li key={incident.id}>
                        <Link
                          to={`/dashboard/incidents/${incident.id}`}
                          className="flex items-center gap-2 border border-border/60 px-2 py-1.5 text-[12px] transition-colors hover:border-border"
                        >
                          <span className="size-1.5 rounded-full" style={{ background: severityDot(incident.severity) }} />
                          <span className="truncate">{incident.title}</span>
                          <span className="ml-auto shrink-0">
                            <StatusBadge status={incident.status} />
                          </span>
                        </Link>
                      </li>
                    ))}
                    {!selectedEntry?.incidents.length && (
                      <li className="text-[11px] text-muted-foreground">No incidents for this service.</li>
                    )}
                  </ul>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                    Recent alerts ({scopedAlerts.filter((a) => a.service === selectedService.id).length})
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {selectedAlerts.map((a) => (
                      <li key={a.id} className="border border-border/60 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <SeverityBadge severity={a.severity} />
                          <span className="tnum text-[11px] text-muted-foreground">{fmtClock(a.ts)}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {a.description}
                        </p>
                      </li>
                    ))}
                    {!selectedAlerts.length && (
                      <li className="text-[11px] text-muted-foreground">No alerts in this window.</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Engine state" description="Current correlation run">
            <dl className="space-y-2 text-xs">
              <Row k="Raw alerts" v={num(analysis.rawAlertCount)} />
              <Row k="Unique alerts" v={num(analysis.uniqueAlertCount)} />
              <Row k="Incidents" v={num(incidents.length)} />
              <Row k="Duration" v={`${analysis.durationMs}ms`} />
            </dl>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border/50 pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="tnum text-foreground">{v}</dd>
    </div>
  );
}
