import type { Alert, Incident, Severity } from "./types";
import { SERVICE_MAP, descendants } from "./services";
import { typeLabel } from "./correlate";

export interface Hypothesis {
  service: string;
  rank: number;
  score: number;
  supporting: string[];
  counter: string;
}

export interface IncidentExplanation {
  summary: string;
  hypotheses: Hypothesis[];
  steps: string[];
  generator: "deterministic" | "ai";
  /** True when the AI path was attempted but unavailable. */
  degraded?: boolean;
}

const CHECKS: Record<Alert["type"], string[]> = {
  connection_pool: [
    "inspect active connections (pg_stat_activity) and pool wait time",
    "identify long-running or blocked queries holding connections",
    "check whether pool sizing changed in the last deploy window",
  ],
  query_latency: [
    "review slow-query log and index usage for the affected relation",
    "check replica lag and read/write split behaviour",
  ],
  request_latency: [
    "check upstream p99 latency from the service's own traces",
    "look for thread-pool or connection-pool saturation on the instance",
  ],
  error_rate: [
    "sample failing requests and group by error class",
    "check dependency health and recent config or flag changes",
  ],
  timeout: [
    "trace a few timed-out requests end to end",
    "compare against the upstream's saturation and queue depth",
  ],
  cpu_saturation: [
    "check CPU throttling, thread count and workload spikes",
    "compare against the autoscaling policy and last scaling event",
  ],
  memory_saturation: [
    "inspect heap/GC metrics and restart history",
    "check for unbounded caches or queue growth",
  ],
  disk_pressure: [
    "check inode and volume utilisation, log rotation",
    "verify retention jobs ran",
  ],
  availability: [
    "verify health checks and recent failover events",
    "confirm the dependency that failed has recovered",
  ],
  certificate_expiry: [
    "rotate the certificate and verify the trust chain",
    "check whether automated renewal is enabled",
  ],
  queue_backlog: [
    "check consumer lag and consumer group restarts",
    "verify downstream handlers are healthy",
  ],
  replication_lag: [
    "check replica WAL position and disk throughput",
    "look for long-running queries pinning the replay slot",
  ],
};

function fmtTime(ts: number, reference: number) {
  const delta = Math.round((ts - reference) / 1000);
  const clock = new Date(ts).toISOString().slice(11, 19);
  return delta === 0 ? `${clock} (T+0s)` : `${clock} (T+${delta}s)`;
}

/**
 * Deterministic explanation generator — used verbatim when no AI model is
 * reachable, and as the structural contract the AI output is validated
 * against. Every sentence is derived from the incident's own alert data.
 */
export function explainIncident(
  incident: Incident,
  alerts: Alert[],
  source: "deterministic" | "ai" = "deterministic",
  degraded = false,
): IncidentExplanation {
  const members = alerts
    .filter((a) => incident.alertIds.includes(a.id))
    .sort((a, b) => a.ts - b.ts);
  if (!members.length) {
    return {
      summary: "No alerts are attached to this incident.",
      hypotheses: [],
      steps: [],
      generator: source,
      degraded,
    };
  }

  const rootName = SERVICE_MAP[incident.probableRootCause]?.name ?? incident.probableRootCause;
  const first = members[0];
  const rootAlerts = members.filter((a) => a.service === incident.probableRootCause);
  const rootFirst = rootAlerts[0]?.ts ?? first.ts;
  const others = [...new Set(members.map((a) => a.service))].filter(
    (s) => s !== incident.probableRootCause,
  );
  const alertedAfter = others.filter((s) => {
    const firstOf = Math.min(...members.filter((a) => a.service === s).map((a) => a.ts));
    return firstOf >= rootFirst;
  });
  const reachable = others.filter((s) => descendants(incident.probableRootCause, 4).includes(s));
  const span = Math.round((members[members.length - 1].ts - first.ts) / 1000);

  const summary =
    others.length === 0
      ? `${rootName} is the only service involved. A single ${typeLabel(first.type)} signal fired at ${fmtTime(first.ts, first.ts)} with no related alerts inside the correlation window, so this incident stands alone rather than being merged into a cascade.`
      : `${rootName} is the leading root-cause candidate: its ${typeLabel(rootFirst === first.ts ? first.type : rootAlerts[0].type)} fired at ${fmtTime(rootFirst, first.ts)}, ahead of ${alertedAfter.length} of ${others.length} other affected services, and ${reachable.length} of those services depend on it in the service graph. The ${span}s spread of signals from ${rootName} outward to ${others.slice(0, 3).join(", ")}${others.length > 3 ? " and others" : ""} is consistent with ${typeLabel(rootAlerts[0]?.type ?? first.type)} propagating downstream rather than ${others.length} independent failures.`;

  const hypotheses: Hypothesis[] = incident.rootCauses.slice(0, 3).map((candidate, index) => {
    const supporting = candidate.signals
      .slice()
      .sort((a, b) => b.points - a.points)
      .slice(0, 4)
      .map((s) => `${s.label}: ${s.detail} (+${s.points})`);
    let counter = "";
    if (index === 0) {
      counter =
        incident.rootCauses.length > 1
          ? `Ranked first, but still a hypothesis — confirm with traces and change history before acting.`
          : `Only candidate in this incident; nothing competes with it.`;
    } else {
      const rootFirstTs = Math.min(
        ...members.filter((a) => a.service === incident.probableRootCause).map((a) => a.ts),
      );
      const ownFirst = members.find((a) => a.service === candidate.service)?.ts ?? rootFirstTs;
      const lag = Math.round((ownFirst - rootFirstTs) / 1000);
      counter =
        lag > 0
          ? `Its first alert trails ${rootName} by ${lag}s, which argues it is a symptom rather than the cause.`
          : `It fired at the same time as ${rootName}, so ordering does not separate them — need trace-level evidence.`;
    }
    return {
      service: candidate.service,
      rank: index + 1,
      score: candidate.score,
      supporting,
      counter,
    };
  });

  const rootCheck = CHECKS[rootFirst === first.ts ? first.type : rootAlerts[0]?.type ?? first.type] ?? [];
  const steps = [
    `Start at ${rootName}: ${rootCheck.join("; ")}.`,
    `Confirm ordering — pull traces for ${fmtTime(rootFirst, first.ts)} and check that downstream errors on ${others.slice(0, 2).join(", ") || "affected services"} begin after the root signal.`,
    `Check change history between ${new Date(first.ts - 30 * 60_000).toISOString().slice(11, 16)}Z and ${new Date(first.ts).toISOString().slice(11, 16)}Z for deploys, config or flag flips on ${rootName}.`,
    others.length
      ? `Validate the blast radius: ${reachable.length} of ${others.length} affected services depend on ${rootName} — confirm they recover once it is remediated.`
      : `No downstream blast radius detected — scope the fix to ${rootName} only.`,
    incident.suppressedCount
      ? `Review the ${incident.suppressedCount} suppressed duplicate alert${incident.suppressedCount > 1 ? "s" : ""} after mitigation to confirm the signal stopped re-firing.`
      : `No duplicates were suppressed for this incident; re-run analysis after mitigation to confirm it clears.`,
  ];

  return { summary, hypotheses, steps, generator: source, degraded };
}

export function severityTone(severity: Severity) {
  return severity === "critical"
    ? "critical"
    : severity === "high"
      ? "warning"
      : severity === "medium"
        ? "info"
        : "muted";
}
