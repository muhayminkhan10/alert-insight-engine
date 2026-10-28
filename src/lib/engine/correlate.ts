import type {
  Alert,
  AlertDecision,
  AnalysisResult,
  Attention,
  CorrelationConfig,
  DuplicateRecord,
  Environment,
  Incident,
  RuleEvidence,
  Severity,
  TimelineEvent,
} from "./types";
import { DEPENDENTS, SERVICE_MAP, graphDistance } from "./services";
import { SEVERITY_RANK, maxSeverity, rankRootCauses } from "./rootcause";

export interface DedupResult {
  unique: Alert[];
  duplicates: DuplicateRecord[];
}

/** Step 1 — collapse identical, in-window firings of the same alert rule. */
export function deduplicate(alerts: Alert[], config: CorrelationConfig): DedupResult {
  const sorted = [...alerts].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const canonical = new Map<string, Alert>();
  const unique: Alert[] = [];
  const duplicates: DuplicateRecord[] = [];

  for (const alert of sorted) {
    const seen = canonical.get(alert.fingerprint);
    if (seen && alert.ts - seen.ts <= config.dedupWindowMs) {
      duplicates.push({
        alert,
        duplicateOf: seen.id,
        deltaSeconds: Math.round((alert.ts - seen.ts) / 1000),
      });
    } else {
      canonical.set(alert.fingerprint, alert);
      unique.push(alert);
    }
  }
  return { unique, duplicates };
}

interface WorkingIncident {
  id: string;
  alerts: Alert[];
  services: Set<string>;
  environment: Environment;
  firstTs: number;
  lastTs: number;
  severity: Severity;
  evidence: Map<string, { text: string; count: number }>;
}

const TYPE_LABEL: Record<Alert["type"], string> = {
  connection_pool: "connection pool exhaustion",
  query_latency: "query latency degradation",
  request_latency: "latency degradation",
  error_rate: "error rate spike",
  timeout: "request timeouts",
  cpu_saturation: "CPU saturation",
  memory_saturation: "memory saturation",
  disk_pressure: "disk pressure",
  availability: "availability loss",
  certificate_expiry: "certificate expiry",
  queue_backlog: "queue backlog",
  replication_lag: "replication lag",
};

export function typeLabel(type: Alert["type"]): string {
  return TYPE_LABEL[type] ?? type;
}

function addEvidence(w: WorkingIncident, text: string) {
  const existing = w.evidence.get(text);
  if (existing) existing.count += 1;
  else w.evidence.set(text, { text, count: 1 });
}

interface ScoredJoin {
  score: number;
  reasons: RuleEvidence[];
  gate?: RuleEvidence;
}

/** Score one candidate incident for whether `alert` belongs to it. */
function scoreJoin(
  w: WorkingIncident,
  alert: Alert,
  config: CorrelationConfig,
  distCache: Map<string, number>,
): ScoredJoin {
  const reasons: RuleEvidence[] = [];

  if (w.environment !== alert.environment) {
    return {
      score: 0,
      reasons,
      gate: {
        rule: "Environment isolation",
        detail: `${alert.environment} alerts never join ${w.environment} incidents`,
        score: 0,
        gate: true,
      },
    };
  }

  const windowGap = alert.ts - w.lastTs;
  if (windowGap > config.timeWindowMs) {
    return {
      score: 0,
      reasons,
      gate: {
        rule: "Time window",
        detail: `${Math.round(windowGap / 60_000)}m after the incident's last event exceeds the ${Math.round(config.timeWindowMs / 60_000)}m window`,
        score: 0,
        gate: true,
      },
    };
  }

  // Nearest dependency distance to any service already in the incident.
  let best = { service: "", hops: Infinity };
  for (const member of w.services) {
    const hops = graphDistance(alert.service, member, config.maxGraphHops, distCache);
    if (hops < best.hops) best = { service: member, hops };
  }

  const sameService = w.services.has(alert.service);
  if (!sameService && !Number.isFinite(best.hops)) {
    return {
      score: 0,
      reasons,
      gate: {
        rule: "Dependency link",
        detail: `${alert.service} is not within ${config.maxGraphHops} dependency hops of ${[...w.services].slice(0, 3).join(", ")}`,
        score: 0,
        gate: true,
      },
    };
  }

  // Nearest temporal distance to any member event (events are processed in order).
  const gaps = w.alerts.map((m) => Math.abs(alert.ts - m.ts));
  const nearestGap = gaps.length ? Math.min(...gaps) : 0;
  if (!sameService && nearestGap > config.temporalGateMs) {
    return {
      score: 0,
      reasons,
      gate: {
        rule: "Temporal proximity",
        detail: `Nearest related event is ${Math.round(nearestGap / 60_000)}m away, beyond the ${Math.round(config.temporalGateMs / 60_000)}m gate`,
        score: 0,
        gate: true,
      },
    };
  }

  let score = 0;
  if (sameService) {
    score += 6;
    reasons.push({
      rule: "Same service",
      detail: `${alert.service} already fired in this incident`,
      score: 6,
    });
  } else {
    const depPoints = best.hops === 1 ? 3 : 2;
    score += depPoints;
    const direction = DEPENDENTS[best.service]?.includes(alert.service)
      ? "depends on"
      : DEPENDENTS[alert.service]?.includes(best.service)
        ? "is called by"
        : "shares a dependency with";
    reasons.push({
      rule: "Dependency graph",
      detail: `${alert.service} ${direction} ${best.service} (${best.hops} hop${best.hops > 1 ? "s" : ""})`,
      score: depPoints,
    });

    const timePoints = nearestGap <= config.temporalGateMs ? 2 : 1;
    score += timePoints;
    reasons.push({
      rule: "Temporal proximity",
      detail: `${Math.round(nearestGap / 1000)}s from the nearest incident event`,
      score: timePoints,
    });

    if (alert.family === familyOf(w)) {
      score += 1;
      reasons.push({
        rule: "Compatible alert types",
        detail: `Both are ${alert.family}-class signals`,
        score: 1,
      });
    }

    if (SEVERITY_RANK[w.severity] > SEVERITY_RANK[alert.severity]) {
      score += 1;
      reasons.push({
        rule: "Cascade severity pattern",
        detail: `Incident peaked at ${w.severity.toUpperCase()} while this alert is ${alert.severity.toUpperCase()} — consistent with a downstream symptom`,
        score: 1,
      });
    }
  }

  return { score, reasons };
}

function familyOf(w: WorkingIncident): string | undefined {
  return w.alerts[0]?.family;
}

function titleFor(w: WorkingIncident, rootCause: string): string {
  const services = [...w.services];
  if (services.length === 1) {
    const first = w.alerts[0];
    return `${SERVICE_MAP[services[0]]?.name ?? services[0]}: ${typeLabel(first.type)}`;
  }
  const rootAlerts = w.alerts.filter((a) => a.service === rootCause);
  const type = rootAlerts[0]?.type ?? w.alerts[0].type;
  return `${SERVICE_MAP[rootCause]?.name ?? rootCause} ${typeLabel(type)} affecting ${services.length} services`;
}

function buildTimeline(w: WorkingIncident, duplicateCount: number): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const first = w.alerts[0];
  events.push({
    ts: first.ts,
    kind: "first",
    service: first.service,
    text: `Incident opened — ${first.description}`,
    severity: first.severity,
  });
  for (const a of w.alerts.slice(1)) {
    events.push({
      ts: a.ts,
      kind: "alert",
      service: a.service,
      text: a.description,
      severity: a.severity,
    });
  }
  if (duplicateCount > 0) {
    const last = w.alerts[w.alerts.length - 1];
    events.push({
      ts: last.ts + 1000,
      kind: "duplicate",
      text: `${duplicateCount} identical repeat firing${duplicateCount > 1 ? "s" : ""} suppressed as duplicates`,
    });
  }
  return events;
}

/**
 * Step 2 — cluster de-duplicated alerts into incidents using dependency
 * position, temporal proximity, alert-type compatibility and cascade
 * severity. Every decision (joined or rejected) is recorded with its rules.
 */
export function correlate(
  alerts: Alert[],
  config: CorrelationConfig,
): Pick<AnalysisResult, "incidents" | "decisions" | "uniqueAlertCount" | "duplicateCount" | "rawAlertCount" | "duplicateIncident"> {
  const { unique, duplicates } = deduplicate(alerts, config);
  const decisions: Record<string, AlertDecision> = {};
  const working: WorkingIncident[] = [];
  const distCache = new Map<string, number>();
  let nextId = 1;

  for (const alert of unique) {
    let best: { w: WorkingIncident; scored: ScoredJoin } | null = null;

    for (const w of working) {
      const scored = scoreJoin(w, alert, config, distCache);
      if (!best || scored.score > best.scored.score) best = { w, scored };
    }

    const joinable = best
      ? best.scored.gate === undefined && best.scored.score >= config.joinThreshold
      : false;

    if (best && joinable) {
      const w = best.w;
      w.alerts.push(alert);
      w.services.add(alert.service);
      w.lastTs = Math.max(w.lastTs, alert.ts);
      w.severity = SEVERITY_RANK[alert.severity] > SEVERITY_RANK[w.severity] ? alert.severity : w.severity;
      for (const r of best.scored.reasons) addEvidence(w, r.detail);
      decisions[alert.id] = {
        alertId: alert.id,
        incidentId: w.id,
        attention: "review",
        signalScore: 0,
        attentionReason: "",
        matched: best.scored.reasons,
      };
    } else {
      const w: WorkingIncident = {
        id: `INC-${String(nextId++).padStart(3, "0")}`,
        alerts: [alert],
        services: new Set([alert.service]),
        environment: alert.environment,
        firstTs: alert.ts,
        lastTs: alert.ts,
        severity: alert.severity,
        evidence: new Map(),
      };
      working.push(w);
      const rejected = best
        ? {
            incidentId: best.w.id,
            score: best.scored.score,
            threshold: config.joinThreshold,
            reasons: best.scored.gate ? [best.scored.gate, ...best.scored.reasons] : best.scored.reasons,
          }
        : undefined;
      decisions[alert.id] = {
        alertId: alert.id,
        incidentId: w.id,
        attention: "review",
        signalScore: 0,
        attentionReason: "",
        matched: [
          {
            rule: "New incident",
            detail: best?.scored.gate
              ? `No compatible incident — ${best.scored.gate.rule.toLowerCase()} gate failed`
              : `No incident reached the score threshold of ${config.joinThreshold} (best: ${best?.scored.score ?? 0})`,
            score: 0,
          },
        ],
        rejected,
      };
    }
  }

  // Attach suppressed duplicates to their canonical alert's incident.
  const duplicateIncident: Record<string, string | undefined> = {};
  for (const dup of duplicates) {
    const owner = decisions[dup.duplicateOf]?.incidentId;
    duplicateIncident[dup.alert.id] = owner ?? undefined;
    decisions[dup.alert.id] = {
      alertId: dup.alert.id,
      incidentId: owner ?? null,
      duplicateOf: dup.duplicateOf,
      attention: "ignore",
      signalScore: 0,
      attentionReason: `Identical to ${dup.duplicateOf} (${dup.deltaSeconds}s apart) — suppressed before correlation`,
      matched: [
        {
          rule: "Fingerprint deduplication",
          detail: `Fingerprint ${dup.alert.fingerprint} already seen ${dup.deltaSeconds}s earlier`,
          score: 0,
          gate: true,
        },
      ],
    };
  }

  // Build final incidents with evidence, root causes, titles and timelines.
  const incidents: Incident[] = working.map((w) => {
    const alertsIn = w.alerts;
    const duplicateIds = duplicates.filter((d) => duplicateIncident[d.alert.id] === w.id).map((d) => d.alert.id);
    const evidence = [...w.evidence.values()]
      .sort((a, b) => b.count - a.count)
      .map((e) => (e.count > 1 ? `${e.text} (×${e.count})` : e.text));
    if (duplicateIds.length > 1) {
      evidence.push(`${duplicateIds.length} duplicate firings of identical fingerprints suppressed`);
    }

    const candidates = rankRootCauses(
      {
        id: w.id,
        title: "",
        severity: w.severity,
        status: "open",
        startTs: w.firstTs,
        lastTs: w.lastTs,
        services: [...w.services],
        alertIds: alertsIn.map((a) => a.id),
        duplicateIds,
        evidence,
        rootCauses: [],
        probableRootCause: "",
        timeline: [],
        environments: [w.environment],
        alertCount: alertsIn.length,
        suppressedCount: duplicateIds.length,
      },
      alertsIn,
    );
    const probable = candidates[0]?.service ?? [...w.services][0];
    const title = titleFor(w, probable);

    return {
      id: w.id,
      title,
      severity: w.severity,
      status: "open" as const,
      startTs: w.firstTs,
      lastTs: w.lastTs,
      services: [...w.services],
      alertIds: alertsIn.map((a) => a.id),
      duplicateIds,
      evidence,
      rootCauses: candidates,
      probableRootCause: probable,
      timeline: buildTimeline(w, duplicateIds.length),
      environments: [w.environment],
      alertCount: alertsIn.length,
      suppressedCount: duplicateIds.length,
    };
  });

  // Attention triage: which alerts deserve a human right now.
  for (const incident of incidents) {
    const multiService = incident.services.length > 1;
    for (const alertId of incident.alertIds) {
      const decision = decisions[alertId];
      const alert = alerts.find((a) => a.id === alertId);
      if (!decision || !alert) continue;
      const isRoot = multiService && incident.probableRootCause === alert.service;
      const isFirst = incident.alertIds[0] === alertId;
      const sevWeight = { critical: 60, high: 40, medium: 15, low: 5 }[alert.severity];
      const incidentBoost = SEVERITY_RANK[incident.severity] >= SEVERITY_RANK["high"] ? 20 : 0;
      const rootBoost = isRoot ? 25 : 0;
      const firstBoost = multiService && isFirst ? 15 : 0;
      const score = sevWeight + incidentBoost + rootBoost + firstBoost;
      let attention: Attention;
      let reason: string;
      if (alert.severity === "critical") {
        attention = "action";
        reason = `Critical severity — ${isRoot ? "root-cause candidate" : "highest-severity signal"} for ${incident.id}`;
      } else if (score >= 65) {
        attention = "action";
        reason = `Signal score ${score}: ${isRoot ? "on the probable root-cause service" : "critical service in a high-severity cascade"}`;
      } else if (score >= 30) {
        attention = "review";
        reason = `Signal score ${score} — ${multiService ? `part of ${incident.id} (${incident.severity} cascade), not a paging signal` : "repeat firing worth watching"}`;
      } else {
        attention = "ignore";
        reason = `Signal score ${score} — low-severity background inside ${incident.id}; safe to defer while the root cause is handled`;
      }
      decision.attention = attention;
      decision.signalScore = score;
      decision.attentionReason = reason;
    }
  }

  // Singletons that never joined anything.
  for (const decision of Object.values(decisions)) {
    if (decision.attention !== "review" || decision.signalScore !== 0) continue;
    const alert = alerts.find((a) => a.id === decision.alertId);
    if (!alert) continue;
    const sevWeight = { critical: 60, high: 40, medium: 15, low: 5 }[alert.severity];
    if (alert.severity === "critical") {
      decision.attention = "action";
      decision.signalScore = sevWeight;
      decision.attentionReason =
        "Isolated critical alert with no correlated neighbours — investigate on its own merits";
    } else if (alert.severity === "high") {
      decision.attention = "review";
      decision.signalScore = sevWeight;
      decision.attentionReason = "High-severity singleton: no cascade around it, so it is a standalone follow-up";
    } else {
      decision.attention = "ignore";
      decision.signalScore = sevWeight;
      decision.attentionReason =
        "Isolated low/medium background alert with no related signals — defer it";
    }
  }

  return {
    incidents: incidents.sort((a, b) => b.lastTs - a.lastTs),
    decisions,
    uniqueAlertCount: unique.length,
    duplicateCount: duplicates.length,
    rawAlertCount: alerts.length,
    duplicateIncident,
  };
}

export function runAnalysis(
  alerts: Alert[],
  config: CorrelationConfig,
): AnalysisResult {
  const started =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const result = correlate(alerts, config);
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    ...result,
    config,
    durationMs: +(ended - started).toFixed(2),
    runAt: Date.now(),
  };
}

export { maxSeverity };
