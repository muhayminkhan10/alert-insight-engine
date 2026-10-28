import { AttentionBadge, SectionCard, SeverityBadge, StatusBadge } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtClock, fmtValue } from "@/lib/format";
import { useStore } from "@/lib/store";
import { SERVICE_MAP } from "@/lib/engine/services";
import type { Alert, Attention } from "@/lib/engine/types";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

type SortKey = "ts" | "severity" | "service" | "signal";
type TimeRange = "all" | "15m" | "1h" | "3h" | "6h";

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 } as const;
const PAGE_SIZE = 25;

const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: "all", label: "Full 6h window" },
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "3h", label: "Last 3 hours" },
  { value: "6h", label: "Last 6 hours" },
];

export function LiveAlertsPage() {
  const { scopedAlerts, analysis, incidents, dataset } = useStore();
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"all" | Alert["severity"]>("all");
  const [service, setService] = useState("all");
  const [type, setType] = useState("all");
  const [attention, setAttention] = useState<"all" | Attention>("all");
  const [range, setRange] = useState<TimeRange>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "ts",
    dir: "desc",
  });
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const incidentIndex = useMemo(
    () => new Map(incidents.map((i) => [i.id, i])),
    [incidents],
  );

  const services = useMemo(
    () => [...new Set(scopedAlerts.map((a) => a.service))].sort(),
    [scopedAlerts],
  );
  const types = useMemo(
    () => [...new Set(scopedAlerts.map((a) => a.type))].sort(),
    [scopedAlerts],
  );

  const counts = useMemo(() => {
    const c = { action: 0, review: 0, ignore: 0, duplicate: 0 };
    for (const a of scopedAlerts) {
      const d = analysis.decisions[a.id];
      if (!d) continue;
      c[d.attention] += 1;
      if (d.duplicateOf) c.duplicate += 1;
    }
    return c;
  }, [scopedAlerts, analysis]);

  const rows = useMemo(() => {
    const now = Date.now();
    const rangeFloor =
      range === "all" ? -Infinity : now - (range === "15m" ? 15 : range === "1h" ? 60 : range === "3h" ? 180 : 360) * 60_000;
    const q = query.trim().toLowerCase();
    const filtered = scopedAlerts.filter((a) => {
      const decision = analysis.decisions[a.id];
      if (!decision) return false;
      if (a.ts < rangeFloor) return false;
      if (severity !== "all" && a.severity !== severity) return false;
      if (service !== "all" && a.service !== service) return false;
      if (type !== "all" && a.type !== type) return false;
      if (attention !== "all" && decision.attention !== attention) return false;
      if (q && !a.id.toLowerCase().includes(q) && !a.service.toLowerCase().includes(q)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const da = analysis.decisions[a.id]!;
      const db = analysis.decisions[b.id]!;
      let cmp = 0;
      if (sort.key === "ts") cmp = a.ts - b.ts;
      else if (sort.key === "severity") cmp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      else if (sort.key === "service") cmp = a.service.localeCompare(b.service);
      else cmp = da.signalScore - db.signalScore;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [scopedAlerts, analysis, query, severity, service, type, attention, range, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const setSortKey = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));

  const resetFilters = () => {
    setQuery("");
    setSeverity("all");
    setService("all");
    setType("all");
    setAttention("all");
    setRange("all");
    setPage(0);
  };

  const filtersActive =
    query !== "" ||
    severity !== "all" ||
    service !== "all" ||
    type !== "all" ||
    attention !== "all" ||
    range !== "all";

  const windowEnd = dataset.windowEnd;

  return (
    <div className="space-y-4">
      {/* Signal triage strip — the demo moment */}
      <section className="grid gap-3 border border-border/70 bg-card p-4 sm:grid-cols-3 sm:p-5">
        <div className="sm:col-span-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium tracking-tight">
              Signal triage — what to act on, what to ignore
            </h2>
            <p className="tnum text-[11px] text-muted-foreground">
              {scopedAlerts.length} alerts in scope · {analysis.duplicateCount} duplicates suppressed
            </p>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Every alert is scored on severity, dependency position, cascade role and duplicate
            status. Only alerts that can change the outcome of an incident are marked to act on.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:col-span-3">
          <TriageCell
            tone="action"
            count={counts.action}
            label="act now"
            hint="Root-cause and critical signals inside an active incident."
            onClick={() => {
              setAttention("action");
              setPage(0);
            }}
            active={attention === "action"}
          />
          <TriageCell
            tone="review"
            count={counts.review}
            label="review"
            hint="Related symptoms — worth a look after the top signal is handled."
            onClick={() => {
              setAttention("review");
              setPage(0);
            }}
            active={attention === "review"}
          />
          <TriageCell
            tone="ignore"
            count={counts.ignore}
            label="safe to ignore"
            hint="Duplicates and isolated background noise — no human action needed."
            onClick={() => {
              setAttention("ignore");
              setPage(0);
            }}
            active={attention === "ignore"}
          />
        </div>
      </section>

      {/* Filters */}
      <SectionCard
        bodyClassName="p-3 sm:p-4"
        title="Alert explorer"
        description={`${rows.length} of ${scopedAlerts.length} alerts match`}
        actions={
          filtersActive ? (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={resetFilters}>
              <X className="size-3" /> Clear filters
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search by alert ID or service…"
              className="h-8 pl-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-1">
            {(["all", "critical", "high", "medium", "low"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSeverity(s);
                  setPage(0);
                }}
                className={`border px-2 py-1 text-[11px] capitalize transition-colors ${
                  severity === s
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <Select
            value={service}
            onValueChange={(v) => {
              setService(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Service" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {services.map((s) => (
                <SelectItem key={s} value={s}>
                  {SERVICE_MAP[s]?.name ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Alert type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All alert types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={range}
            onValueChange={(v) => {
              setRange(v as TimeRange);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SectionCard>

      {/* Table */}
      <SectionCard
        bodyClassName="p-0"
        title="Alerts"
        description={`Sorted by ${sort.key} · page ${currentPage + 1} of ${pageCount}`}
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={currentPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <th className="w-8 px-3 py-2" />
                <SortHeader label="Signal" active={sort.key === "signal"} dir={sort.dir} onClick={() => setSortKey("signal")} />
                <SortHeader label="Severity" active={sort.key === "severity"} dir={sort.dir} onClick={() => setSortKey("severity")} />
                <SortHeader label="Time" active={sort.key === "ts"} dir={sort.dir} onClick={() => setSortKey("ts")} />
                <SortHeader label="Service" active={sort.key === "service"} dir={sort.dir} onClick={() => setSortKey("service")} />
                <th className="px-3 py-2 font-normal">Alert</th>
                <th className="px-3 py-2 font-normal">Observed</th>
                <th className="px-3 py-2 font-normal">Incident</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((a) => {
                const decision = analysis.decisions[a.id]!;
                const incident = decision.incidentId ? incidentIndex.get(decision.incidentId) : undefined;
                const isDuplicate = Boolean(decision.duplicateOf);
                const isOpen = expanded === a.id;
                return (
                  <AlertRow
                    key={a.id}
                    alert={a}
                    decision={decision}
                    incident={incident}
                    isDuplicate={isDuplicate}
                    open={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : a.id)}
                    windowEnd={windowEnd}
                  />
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    No alerts match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2 font-normal">
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.08em] transition-colors ${
          active ? "text-foreground" : "hover:text-foreground"
        }`}
      >
        {label}
        <span className="text-[9px]">{active ? (dir === "desc" ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
}

function TriageCell({
  tone,
  count,
  label,
  hint,
  onClick,
  active,
}: {
  tone: Attention;
  count: number;
  label: string;
  hint: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-1 border px-3 py-3 text-left transition-colors ${
        active ? "border-foreground/40 bg-accent/40" : "border-border/70 hover:border-border"
      }`}
    >
      <span className={`tnum text-2xl font-medium leading-none ${
        tone === "action" ? "sev-critical" : tone === "review" ? "sev-warning" : "sev-muted"
      }`}>
        {count}
      </span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <span className="text-[11px] leading-snug text-muted-foreground/80">{hint}</span>
    </button>
  );
}

function AlertRow({
  alert,
  decision,
  incident,
  isDuplicate,
  open,
  onToggle,
  windowEnd,
}: {
  alert: Alert;
  decision: ReturnType<typeof useStore>["analysis"]["decisions"][string];
  incident: ReturnType<typeof useStore>["incidents"][number] | undefined;
  isDuplicate: boolean;
  open: boolean;
  onToggle: () => void;
  windowEnd: number;
}) {
  const rel = Math.round((windowEnd - alert.ts) / 60_000);
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-border/40 align-middle transition-colors hover:bg-accent/30 ${
          open ? "bg-accent/40" : ""
        }`}
      >
        <td className="px-3 py-2.5 text-muted-foreground">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </td>
        <td className="px-3 py-2.5">
          <AttentionBadge attention={decision.attention} />
        </td>
        <td className="px-3 py-2.5">
          <SeverityBadge severity={alert.severity} />
        </td>
        <td className="tnum px-3 py-2.5 text-xs text-muted-foreground">
          {fmtClock(alert.ts)}
          <span className="ml-1.5 text-[10px] opacity-70">−{rel}m</span>
        </td>
        <td className="px-3 py-2.5 text-[13px] text-foreground">
          {SERVICE_MAP[alert.service]?.name ?? alert.service}
        </td>
        <td className="max-w-[280px] px-3 py-2.5">
          <p className="truncate text-[13px] text-foreground">{alert.description}</p>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {alert.type.replace(/_/g, " ")}
            {isDuplicate && <span className="ml-2 sev-muted">duplicate</span>}
          </p>
        </td>
        <td className="tnum px-3 py-2.5 text-xs text-muted-foreground">
          {fmtValue(alert.value, alert.unit)}
          <span className="text-[10px] opacity-70"> / {fmtValue(alert.threshold, alert.unit)}</span>
        </td>
        <td className="px-3 py-2.5 text-xs">
          {incident ? (
            <Link
              to={`/dashboard/incidents/${incident.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              {incident.id}
              <StatusBadge status={incident.status} />
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-background/60">
          <td />
          <td colSpan={7} className="px-3 py-4">
            <div className="grid gap-5 lg:grid-cols-3">
              <div>
                <DetailHeading>Alert payload</DetailHeading>
                <dl className="mt-2 space-y-1.5 text-xs">
                  <DetailRow k="Alert ID" v={alert.id} />
                  <DetailRow k="Timestamp" v={new Date(alert.ts).toISOString()} />
                  <DetailRow k="Environment" v={alert.environment} />
                  <DetailRow k="Source" v={alert.source} />
                  <DetailRow k="Metric" v={`${alert.metric} = ${fmtValue(alert.value, alert.unit)}`} />
                  <DetailRow k="Threshold" v={fmtValue(alert.threshold, alert.unit)} />
                  <DetailRow k="Fingerprint" v={alert.fingerprint} />
                  <DetailRow
                    k="Ingestion"
                    v={alert.ingestDelayMs ? `delayed by ${Math.round(alert.ingestDelayMs / 1000)}s` : "on time"}
                  />
                </dl>
              </div>

              <div>
                <DetailHeading>Why this classification</DetailHeading>
                <p className="mt-2 text-xs leading-relaxed text-foreground/90">
                  {decision.attentionReason}
                </p>
                <p className="tnum mt-2 text-[11px] text-muted-foreground">
                  Signal score {decision.signalScore} · threshold for action is 65
                </p>
                {decision.duplicateOf && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Suppressed as an exact repeat of{" "}
                    <span className="text-foreground">{decision.duplicateOf}</span>.
                  </p>
                )}
              </div>

              <div>
                <DetailHeading>Correlation decision</DetailHeading>
                <ul className="mt-2 space-y-2">
                  {decision.matched.map((rule, i) => (
                    <li key={i} className="text-xs">
                      <span className="text-foreground">{rule.rule}</span>
                      <span className="tnum ml-1.5 text-[11px] text-muted-foreground">
                        +{rule.score}
                      </span>
                      <p className="text-muted-foreground">{rule.detail}</p>
                    </li>
                  ))}
                </ul>
                {decision.rejected && (
                  <div className="mt-3 border-l-2 border-[var(--sev-warning)]/50 pl-3">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                      Excluded from {decision.rejected.incidentId} (score {decision.rejected.score} /{" "}
                      {decision.rejected.threshold})
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {decision.rejected.reasons.map((r, i) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          <span className="text-foreground/80">{r.rule}:</span> {r.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {incident && (
                  <Link
                    to={`/dashboard/incidents/${incident.id}`}
                    className="mt-3 inline-block text-xs underline decoration-border underline-offset-4 hover:decoration-foreground"
                  >
                    Open {incident.id} — {incident.title}
                  </Link>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{children}</p>
  );
}

function DetailRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/40 pb-1">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="tnum truncate text-right text-foreground">{v}</dd>
    </div>
  );
}
