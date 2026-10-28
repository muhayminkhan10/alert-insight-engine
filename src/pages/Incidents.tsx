import { SectionCard, SeverityBadge, StatusBadge, severityDot } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtClock, num } from "@/lib/format";
import { SERVICE_MAP } from "@/lib/engine/services";
import type { IncidentStatus, Severity } from "@/lib/engine/types";
import { useStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { Link } from "react-router";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function IncidentsPage() {
  const { incidents, analysis, scopedAlerts } = useStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | IncidentStatus>("all");
  const [severity, setSeverity] = useState<"all" | Severity>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents
      .filter((i) => {
        if (status !== "all" && i.status !== status) return false;
        if (severity !== "all" && i.severity !== severity) return false;
        if (!q) return true;
        return (
          i.id.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q) ||
          i.services.some((s) => s.toLowerCase().includes(q))
        );
      })
      .sort(
        (a, b) =>
          SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.lastTs - a.lastTs,
      );
  }, [incidents, query, status, severity]);

  const grouped = useMemo(() => {
    const multi = rows.filter((r) => r.services.length > 1 || r.alertCount > 1);
    const single = rows.filter((r) => r.services.length === 1 && r.alertCount === 1);
    return { multi, single };
  }, [rows]);

  const stats = useMemo(() => {
    const cascades = incidents.filter((i) => i.services.length > 1).length;
    const suppressed = incidents.reduce((sum, i) => sum + i.suppressedCount, 0);
    return { cascades, suppressed };
  }, [incidents]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 border border-border/70 bg-card p-4 sm:grid-cols-4 sm:p-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Incidents</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none">{num(incidents.length)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Multi-service cascades</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none sev-warning">{num(stats.cascades)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Singleton incidents</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none text-muted-foreground">
            {num(incidents.length - stats.cascades)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Duplicates suppressed</p>
          <p className="tnum mt-1.5 text-2xl font-medium leading-none">{num(stats.suppressed)}</p>
        </div>
      </div>

      <SectionCard
        bodyClassName="p-0"
        title="Incident register"
        description={`${rows.length} of ${incidents.length} shown · ${analysis.rawAlertCount} raw alerts collapsed into ${incidents.length} incidents`}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search incident, service or ID…"
              className="h-8 text-xs"
            />
          </div>
          <Select value={severity} onValueChange={(v) => setSeverity(v as "all" | Severity)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">critical</SelectItem>
              <SelectItem value="high">high</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="low">low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as "all" | IncidentStatus)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">open</SelectItem>
              <SelectItem value="acknowledged">acknowledged</SelectItem>
              <SelectItem value="resolved">resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="divide-y divide-border/50">
          {grouped.multi.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
          {grouped.multi.length > 0 && grouped.single.length > 0 && (
            <p className="bg-background/40 px-4 py-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground sm:px-5">
              Isolated incidents — kept separate from the cascades above
            </p>
          )}
          {grouped.single.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
          {rows.length === 0 && (
            <p className="px-5 py-10 text-center text-xs text-muted-foreground">
              No incidents match these filters.
            </p>
          )}
        </div>
      </SectionCard>

      <p className="text-[11px] text-muted-foreground">
        Baseline comparison: treating every unique alert as its own incident would create{" "}
        <span className="tnum text-foreground">{num(analysis.uniqueAlertCount)}</span> incidents for
        the same {num(scopedAlerts.length)} alerts — the correlation engine produced{" "}
        <span className="tnum text-foreground">{num(incidents.length)}</span>.
      </p>
    </div>
  );
}

function IncidentRow({ incident }: { incident: ReturnType<typeof useStore>["incidents"][number] }) {
  const isCascade = incident.services.length > 1;
  return (
    <Link
      to={`/dashboard/incidents/${incident.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-accent/30 sm:px-5"
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: severityDot(incident.severity) }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-foreground">{incident.title}</p>
        <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
          {incident.id} · {fmtClock(incident.startTs)} · root cause:{" "}
          {SERVICE_MAP[incident.probableRootCause]?.name ?? incident.probableRootCause}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="tnum hidden text-[11px] text-muted-foreground sm:inline">
          {incident.alertCount} alerts
          {incident.suppressedCount > 0 && ` +${incident.suppressedCount} dup`}
        </span>
        <span className="tnum hidden text-[11px] text-muted-foreground md:inline">
          {incident.services.length} services
        </span>
        <span
          className={`hidden text-[11px] md:inline ${isCascade ? "sev-warning" : "text-muted-foreground"}`}
        >
          {isCascade ? "cascade" : "isolated"}
        </span>
        <SeverityBadge severity={incident.severity} />
        <StatusBadge status={incident.status} />
      </div>
    </Link>
  );
}

export function IncidentsActionButtons() {
  const { resetDemo } = useStore();
  return (
    <Button size="sm" variant="outline" onClick={resetDemo}>
      Reset demo
    </Button>
  );
}
