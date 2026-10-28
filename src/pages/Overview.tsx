import {
  MetricCard,
  SectionCard,
  SeverityBadge,
  StatusBadge,
  severityDot,
} from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtClock, num, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Severity } from "@/lib/engine/types";
import { Activity, RotateCcw, Sparkles, Timer } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "var(--sev-critical)",
  high: "var(--sev-warning)",
  medium: "var(--sev-info)",
  low: "var(--sev-muted)",
};

const SEVERITY_LIST: Severity[] = ["critical", "high", "medium", "low"];

export function OverviewPage() {
  const {
    scopedAlerts,
    analysis,
    incidents,
    evaluation,
    dataset,
    generateFresh,
    resetDemo,
    runAnalysisNow,
    config,
    setConfig,
    activity,
  } = useStore();

  const kpis = useMemo(() => {
    const active = incidents.filter((i) => i.status !== "resolved").length;
    const resolved = incidents.filter((i) => i.status === "resolved").length;
    const acknowledged = incidents.filter((i) => i.status === "acknowledged").length;
    const open = incidents.length - acknowledged - resolved;
    const noiseReduction = 1 - incidents.length / Math.max(1, analysis.rawAlertCount);
    return { active, open, acknowledged, resolved, noiseReduction };
  }, [incidents, analysis.rawAlertCount]);

  const volume = useMemo(() => {
    const start = dataset.windowStart;
    const bucketMs = 15 * 60_000;
    const buckets = new Map<number, Record<string, number>>();
    for (const alert of scopedAlerts) {
      const index = Math.floor((alert.ts - start) / bucketMs);
      const entry = buckets.get(index) ?? { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
      entry[alert.severity] += 1;
      entry.total += 1;
      buckets.set(index, entry);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, counts]) => {
        const ts = start + index * bucketMs;
        return {
          label: fmtClock(ts).slice(0, 5),
          ...counts,
        };
      });
  }, [scopedAlerts, dataset.windowStart]);

  const severityDistribution = useMemo(
    () =>
      SEVERITY_LIST.map((s) => ({
        name: s,
        value: scopedAlerts.filter((a) => a.severity === s).length,
        color: SEVERITY_COLORS[s],
      })).filter((d) => d.value > 0),
    [scopedAlerts],
  );

  const topServices = useMemo(() => {
    const counts = new Map<string, number>();
    for (const incident of incidents) {
      for (const s of incident.services) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([service, count]) => ({ service, count }));
  }, [incidents]);

  const recentIncidents = useMemo(
    () => [...incidents].sort((a, b) => b.lastTs - a.lastTs).slice(0, 6),
    [incidents],
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={runAnalysisNow}>
          <Sparkles className="size-3.5" strokeWidth={1.8} /> Run analysis
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={generateFresh}>
          Generate fresh dataset
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={resetDemo}>
          <RotateCcw className="size-3.5" strokeWidth={1.8} /> Reset demo
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-3 border border-border/70 px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            <Timer className="size-3.5" strokeWidth={1.6} /> correlation window
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            group by
            <Input
              type="number"
              min={1}
              max={60}
              value={config.timeWindowMs / 60_000}
              onChange={(e) =>
                setConfig({ timeWindowMs: Math.max(1, Number(e.target.value) || 1) * 60_000 })
              }
              className="tnum h-6 w-16 px-1.5 text-xs"
            />
            min
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            dedupe within
            <Input
              type="number"
              min={1}
              max={30}
              value={config.dedupWindowMs / 60_000}
              onChange={(e) =>
                setConfig({ dedupWindowMs: Math.max(1, Number(e.target.value) || 1) * 60_000 })
              }
              className="tnum h-6 w-16 px-1.5 text-xs"
            />
            min
          </label>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Total alerts" value={num(analysis.rawAlertCount)} hint={`Seed #${dataset.seed}, 6h synthetic window`} />
        <MetricCard label="Unique alerts" value={num(analysis.uniqueAlertCount)} hint={`${num(analysis.duplicateCount)} duplicates removed before correlation`} />
        <MetricCard label="Active incidents" value={num(kpis.active)} tone={kpis.open ? "warning" : "default"} hint={`${kpis.open} open · ${kpis.acknowledged} ack · ${kpis.resolved} resolved`} />
        <MetricCard label="Duplicates suppressed" value={num(analysis.duplicateCount)} hint="Identical fingerprint inside the dedupe window" />
        <MetricCard label="Noise reduction" value={pct(kpis.noiseReduction)} tone="ok" hint="1 − (incidents / raw alerts)" />
        <MetricCard
          label="Root-cause accuracy"
          value={pct(evaluation.proposedRootTop1)}
          tone={evaluation.proposedRootTop1 >= 0.8 ? "ok" : "warning"}
          hint={`Top-1 candidate vs labels · ${evaluation.scopeLabel}`}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Alert volume over time"
          description="15-minute buckets, stacked by severity"
        >
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volume} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="oklch(1 0 0 / 6%)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 4%)" }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                  labelStyle={{ color: "var(--foreground)" }}
                />
                {SEVERITY_LIST.map((s) => (
                  <Bar key={s} dataKey={s} stackId="a" fill={SEVERITY_COLORS[s]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Severity distribution" description="All alerts in scope">
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={severityDistribution}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="none"
                >
                  {severityDistribution.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {severityDistribution.map((entry) => (
              <span key={entry.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: entry.color }} />
                {entry.name} <span className="tnum text-foreground">{entry.value}</span>
              </span>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Top affected services" description="Services appearing in incidents">
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topServices} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="oklch(1 0 0 / 6%)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="service" width={104} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 4%)" }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="count" fill="oklch(0.75 0.002 260)" barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Incident status breakdown" description={`${incidents.length} incidents from the last run`}>
          <ul className="space-y-3">
            {(
              [
                { key: "open", label: "Open", count: kpis.open, color: "var(--sev-warning)" },
                { key: "acknowledged", label: "Acknowledged", count: kpis.acknowledged, color: "var(--sev-info)" },
                { key: "resolved", label: "Resolved", count: kpis.resolved, color: "var(--sev-ok)" },
              ] as const
            ).map((row) => {
              const ratio = incidents.length ? row.count / incidents.length : 0;
              return (
                <li key={row.key}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-foreground">{row.label}</span>
                    <span className="tnum text-muted-foreground">
                      {row.count} · {pct(ratio, 0)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full bg-muted/60">
                    <div className="h-full transition-all" style={{ width: `${ratio * 100}%`, background: row.color }} />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 border-t border-border/60 pt-4">
            <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Recent activity</p>
            <ul className="mt-2 space-y-2">
              {activity.slice(0, 6).map((item, i) => (
                <li key={i} className="flex gap-2 text-[11px]">
                  <Activity className="mt-0.5 size-3 shrink-0 text-muted-foreground" strokeWidth={1.6} />
                  <span className="text-muted-foreground">
                    <span className="tnum text-foreground/80">{fmtClock(item.ts)}</span> {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent incidents"
          description="Newest first"
          actions={
            <Link to="/dashboard/incidents" className="text-[11px] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground">
              View all
            </Link>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border/50">
            {recentIncidents.map((incident) => (
              <li key={incident.id}>
                <Link
                  to={`/dashboard/incidents/${incident.id}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/30 sm:px-5"
                >
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: severityDot(incident.severity) }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">{incident.title}</p>
                    <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
                      {incident.id} · {incident.alertCount} alerts · {incident.services.length} services · {fmtClock(incident.startTs)}
                    </p>
                  </div>
                  <StatusBadge status={incident.status} />
                </Link>
              </li>
            ))}
            {recentIncidents.length === 0 && (
              <li className="px-5 py-8 text-center text-xs text-muted-foreground">
                Run the analysis to create incidents.
              </li>
            )}
          </ul>
        </SectionCard>
      </div>

      <p className="text-[11px] text-muted-foreground">
        All figures are computed from the synthetic dataset currently loaded —{" "}
        {num(scopedAlerts.length)} alerts across{" "}
        {new Set(scopedAlerts.map((a) => a.service)).size} simulated microservices. Highest severity
        in scope:{" "}
        <span className="inline-flex align-middle">
          <SeverityBadge severity={SEVERITY_LIST.find((s) => scopedAlerts.some((a) => a.severity === s)) ?? "low"} />
        </span>
      </p>
    </div>
  );
}
