import type {
  Alert,
  Incident,
  RootCauseCandidate,
  RootCauseSignal,
  Severity,
} from "./types";
import { SERVICE_MAP, descendants } from "./services";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const SEVERITY_POINTS: Record<Severity, number> = {
  critical: 6,
  high: 4,
  medium: 2,
  low: 1,
};

export function maxSeverity(alerts: Alert[]): Severity {
  return alerts.reduce<Severity>(
    (acc, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[acc] ? a.severity : acc),
    "low",
  );
}

/**
 * Transparent root-cause ranking.
 *
 * Candidates are the services that fired alerts plus the upstream services
 * they depend on. Each candidate accumulates points from independent,
 * individually explainable signals: dependency-graph reach, event ordering,
 * severity, propagation consistency and upstream position. Every point is
 * returned as a signal so the UI can show exactly why a candidate ranked where
 * it did.
 */
export function rankRootCauses(incident: Incident, alerts: Alert[]): RootCauseCandidate[] {
  const byService = new Map<string, Alert[]>();
  for (const a of alerts) {
    const list = byService.get(a.service) ?? [];
    list.push(a);
    byService.set(a.service, list);
  }

  const candidateIds = new Set<string>(incident.services);
  for (const service of incident.services) {
    for (const dep of SERVICE_MAP[service]?.deps ?? []) candidateIds.add(dep);
  }
  for (const id of [...candidateIds]) {
    for (const dep of SERVICE_MAP[id]?.deps ?? []) {
      if (byService.has(dep)) candidateIds.add(dep);
    }
  }

  const incidentStart = incident.startTs;

  const candidates: RootCauseCandidate[] = [];
  for (const id of candidateIds) {
    const own = byService.get(id) ?? [];
    const ownFirst = own.length ? Math.min(...own.map((a) => a.ts)) : Infinity;
    const signals: RootCauseSignal[] = [];

    // 1. Dependency-graph reach inside the incident.
    const affected = incident.services.filter((s) => s !== id);
    const reachable = affected.filter((s) => descendants(id, 4).includes(s));
    if (reachable.length) {
      signals.push({
        label: "Downstream reach",
        detail: `${reachable.length} of ${affected.length} affected services depend on ${id} (${reachable.slice(0, 4).join(", ")}${reachable.length > 4 ? "…" : ""})`,
        points: reachable.length * 3,
      });
    }

    // 2. Event ordering — did this service fire before the others?
    const firstTimes = incident.services
      .map((s) => Math.min(...alerts.filter((a) => a.service === s).map((a) => a.ts)))
      .filter((t) => Number.isFinite(t));
    const afterMe = firstTimes.filter((t) => t >= ownFirst).length;
    const isEarliest = Number.isFinite(ownFirst) && ownFirst <= incidentStart + 1;
    if (isEarliest) {
      signals.push({
        label: "Event ordering",
        detail: `First alert of the incident at ${new Date(ownFirst).toISOString().slice(11, 19)} — precedes every other affected service`,
        points: 8,
      });
    } else if (Number.isFinite(ownFirst) && firstTimes.length) {
      signals.push({
        label: "Event ordering",
        detail: `${afterMe} of ${firstTimes.length} affected services alerted after ${id}`,
        points: +(4 * (afterMe / firstTimes.length)).toFixed(1),
      });
    }

    // 3. Own alert severity.
    const ownSeverity = own.length ? maxSeverity(own) : null;
    if (ownSeverity) {
      signals.push({
        label: "Severity of its own alerts",
        detail: `Highest severity on ${id} is ${ownSeverity.toUpperCase()} (${own.length} alert${own.length > 1 ? "s" : ""})`,
        points: SEVERITY_POINTS[ownSeverity],
      });
    }

    // 4. Propagation consistency — do other services fire after this one?
    if (Number.isFinite(ownFirst) && own.length) {
      const others = alerts.filter((a) => a.service !== id);
      const consistent = others.filter((a) => a.ts >= ownFirst).length;
      if (others.length) {
        signals.push({
          label: "Propagation pattern",
          detail: `${consistent} of ${others.length} alerts in the incident occur after ${id} started, matching downstream propagation`,
          points: +(4 * (consistent / others.length)).toFixed(1),
        });
      }
    }

    // 5. Upstream position in the dependency graph.
    const isUpstream = affected.some((s) => descendants(id, 3).includes(s));
    if (isUpstream) {
      signals.push({
        label: "Upstream position",
        detail: `${id} sits upstream of at least one affected service in the dependency graph`,
        points: 3,
      });
    }

    if (!signals.length) continue;
    const score = +signals.reduce((sum, s) => sum + s.points, 0).toFixed(1);
    candidates.push({ service: id, score, signals });
  }

  candidates.sort((a, b) => b.score - a.score || a.service.localeCompare(b.service));
  return candidates;
}
