import { deduplicate } from "./correlate";
import type {
  Alert,
  CorrelationConfig,
  EvaluationResult,
  GroundTruthIncident,
  Incident,
  MatchDetail,
  MatchMetrics,
} from "./types";

/** Incident overlap for the matching rule: |A ∩ B| / |A ∪ B|. */
function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const id of a) if (b.has(id)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const MATCH_THRESHOLD = 0.5;

interface MatchOutcome {
  matched: Array<{ predicted: string; truth: string; overlap: number }>;
  falsePositives: string[];
  falseNegatives: string[];
}

/**
 * Greedy overlap matching between predicted incidents and ground-truth
 * incidents. Predictions are considered best-overlap first; a prediction
 * counts as a true positive when its Jaccard overlap with an unseen ground
 * truth is >= 0.5. Remaining predictions are false positives, remaining
 * ground truths are false negatives.
 */
function match(
  predictions: Array<{ id: string; alertIds: string[] }>,
  truths: GroundTruthIncident[],
): MatchOutcome {
  const pairs: Array<{ p: string; t: string; overlap: number }> = [];
  for (const p of predictions) {
    const ps = new Set(p.alertIds);
    for (const t of truths) {
      const overlap = jaccard(ps, new Set(t.alertIds));
      if (overlap > 0) pairs.push({ p: p.id, t: t.id, overlap });
    }
  }
  pairs.sort((a, b) => b.overlap - a.overlap);

  const usedP = new Set<string>();
  const usedT = new Set<string>();
  const matched: MatchOutcome["matched"] = [];
  for (const pair of pairs) {
    if (usedP.has(pair.p) || usedT.has(pair.t)) continue;
    if (pair.overlap < MATCH_THRESHOLD) continue;
    usedP.add(pair.p);
    usedT.add(pair.t);
    matched.push({ predicted: pair.p, truth: pair.t, overlap: pair.overlap });
  }
  return {
    matched,
    falsePositives: predictions.filter((p) => !usedP.has(p.id)).map((p) => p.id),
    falseNegatives: truths.filter((t) => !usedT.has(t.id)).map((t) => t.id),
  };
}

function metrics(outcome: MatchOutcome, predictionCount: number, truthCount: number): MatchMetrics {
  const tp = outcome.matched.length;
  const fp = outcome.falsePositives.length;
  const fn = outcome.falseNegatives.length;
  const precision = predictionCount ? tp / predictionCount : 0;
  const recall = truthCount ? tp / truthCount : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
  };
}

function scopeTruths(
  truths: GroundTruthIncident[],
  scopedIds: Set<string>,
): GroundTruthIncident[] {
  return truths
    .map((t) => ({ ...t, alertIds: t.alertIds.filter((id) => scopedIds.has(id)) }))
    .filter((t) => t.alertIds.length > 0);
}

export interface EvaluateInput {
  alerts: Alert[];
  groundTruth: GroundTruthIncident[];
  /** Correlation settings — the baseline deduplicates with the same rule. */
  config: CorrelationConfig;
  /** Incidents produced by the correlation engine. */
  proposed: Incident[];
  /** Measured execution time of the correlation pass, in ms. */
  proposedMs: number;
  scopeLabel: string;
  /** Root-cause predictions are only compared on matched incidents. */
  baselineMs?: number;
}

/**
 * Compares two detectors on the same synthetic dataset:
 *  - baseline: every unique (de-duplicated) alert is its own incident
 *  - proposed: the correlation engine's grouping
 * Both are scored against ground truth with the same overlap rule, and both
 * groups include the suppressed duplicates that belong to them, so duplicate
 * suppression is attributed rather than penalised.
 */
export function evaluate(input: EvaluateInput): EvaluationResult {
  const { alerts, groundTruth, proposed } = input;
  const scopedIds = new Set(alerts.map((a) => a.id));
  const truths = scopeTruths(groundTruth, scopedIds);

  // Baseline: one incident per unique alert, duplicates attributed to the
  // fingerprint they were suppressed from — same dedup rule as the engine.
  const { unique, duplicates } = deduplicate(alerts, input.config);
  const dupByCanonical = new Map<string, string[]>();
  for (const d of duplicates) {
    const list = dupByCanonical.get(d.duplicateOf) ?? [];
    list.push(d.alert.id);
    dupByCanonical.set(d.duplicateOf, list);
  }
  const uniqueAlerts = unique;
  const baselineIncidents: Array<{ id: string; alertIds: string[] }> = unique.map((u) => ({
    id: `BASE-${u.id}`,
    alertIds: [u.id, ...(dupByCanonical.get(u.id) ?? [])],
  }));
  const alertById = new Map(alerts.map((a) => [a.id, a]));

  // Predictions claim their suppressed duplicates too, so a group is scored
  // on every alert it accounts for.
  const proposedIncidents = proposed.map((p) => ({
    id: p.id,
    alertIds: [...p.alertIds, ...p.duplicateIds],
  }));
  const baselineOutcome = match(baselineIncidents, truths);
  const proposedOutcome = match(proposedIncidents, truths);

  // Root-cause top-1 accuracy, scored separately on each detector's own
  // matched groups: the baseline can only name the service of its fragment's
  // canonical alert, the engine names its ranked probable root cause.
  let baselineRootCorrect = 0;
  let baselineRootTotal = 0;
  let proposedRootCorrect = 0;
  let proposedRootTotal = 0;
  const matchDetail: MatchDetail[] = [];

  for (const m of baselineOutcome.matched) {
    const truth = truths.find((t) => t.id === m.truth);
    const group = baselineIncidents.find((p) => p.id === m.predicted);
    const first = group ? alertById.get(group.alertIds[0]) : undefined;
    if (!truth || !first) continue;
    baselineRootTotal += 1;
    if (first.service === truth.rootCause) baselineRootCorrect += 1;
  }

  for (const t of truths) {
    const predictedPair = proposedOutcome.matched.find((m) => m.truth === t.id);
    const predictedIncident = predictedPair
      ? proposed.find((p) => p.id === predictedPair.predicted)
      : undefined;
    const overlap = predictedPair?.overlap ?? 0;
    let rootCorrect: boolean | null = null;
    if (predictedIncident) {
      proposedRootTotal += 1;
      rootCorrect = predictedIncident.probableRootCause === t.rootCause;
      if (rootCorrect) proposedRootCorrect += 1;
    }
    matchDetail.push({
      groundTruthId: t.id,
      title: t.title,
      scenarioName: t.scenarioName,
      rootCause: t.rootCause,
      predictedId: predictedIncident?.id ?? null,
      predictedTitle: predictedIncident?.title ?? null,
      overlap: +overlap.toFixed(3),
      rootCorrect,
      size: t.alertIds.length,
    });
  }

  const baselineMetrics = metrics(baselineOutcome, baselineIncidents.length, truths.length);
  const proposedMetrics = metrics(proposedOutcome, proposedIncidents.length, truths.length);
  const proposedCount = proposed.length;

  const rows: EvaluationResult["rows"] = [
    {
      label: "Raw alert count",
      definition: "All generated events including duplicates and late arrivals",
      baseline: alerts.length,
      proposed: alerts.length,
      higherIsBetter: false,
      format: "number",
    },
    {
      label: "Unique alert count",
      definition: "Alerts remaining after fingerprint deduplication",
      baseline: uniqueAlerts.length,
      proposed: uniqueAlerts.length,
      higherIsBetter: false,
      format: "number",
    },
    {
      label: "Predicted incident count",
      definition: "Incidents the detector asks a human to look at",
      baseline: baselineIncidents.length,
      proposed: proposedCount,
      higherIsBetter: false,
      format: "number",
    },
    {
      label: "Ground-truth incident count",
      definition: "Labelled incidents in the synthetic dataset",
      baseline: truths.length,
      proposed: truths.length,
      higherIsBetter: false,
      format: "number",
    },
    {
      label: "Alert reduction rate",
      definition: "1 − (predicted incidents / unique alerts)",
      baseline: 1 - (baselineIncidents.length || 1) / uniqueAlerts.length,
      proposed: 1 - proposedCount / (uniqueAlerts.length || 1),
      higherIsBetter: true,
      format: "percent",
    },
    {
      label: "Incident grouping precision",
      definition: "Matched groups / predicted groups (Jaccard ≥ 0.5)",
      baseline: baselineMetrics.precision,
      proposed: proposedMetrics.precision,
      higherIsBetter: true,
      format: "percent",
    },
    {
      label: "Incident grouping recall",
      definition: "Matched groups / ground-truth groups",
      baseline: baselineMetrics.recall,
      proposed: proposedMetrics.recall,
      higherIsBetter: true,
      format: "percent",
    },
    {
      label: "F1",
      definition: "Harmonic mean of grouping precision and recall",
      baseline: baselineMetrics.f1,
      proposed: proposedMetrics.f1,
      higherIsBetter: true,
      format: "percent",
    },
    {
      label: "False positives",
      definition: "Predicted groups with no ground-truth counterpart",
      baseline: baselineMetrics.falsePositives,
      proposed: proposedMetrics.falsePositives,
      higherIsBetter: false,
      format: "number",
    },
    {
      label: "False negatives",
      definition: "Ground-truth groups the detector failed to produce",
      baseline: baselineMetrics.falseNegatives,
      proposed: proposedMetrics.falseNegatives,
      higherIsBetter: false,
      format: "number",
    },
    {
      label: "Root-cause top-1 accuracy",
      definition: "Top-ranked candidate equals the labelled root cause",
      baseline: baselineRootTotal ? baselineRootCorrect / baselineRootTotal : 0,
      proposed: proposedRootTotal ? proposedRootCorrect / proposedRootTotal : 0,
      higherIsBetter: true,
      format: "percent",
    },
    {
      label: "Analysis execution time",
      definition: "Measured wall-clock time of the detection pass",
      baseline: input.baselineMs ?? 0,
      proposed: input.proposedMs,
      higherIsBetter: false,
      format: "ms",
    },
  ];

  return {
    scopeLabel: input.scopeLabel,
    rawAlertCount: alerts.length,
    uniqueAlertCount: uniqueAlerts.length,
    baselineIncidentCount: baselineIncidents.length,
    proposedIncidentCount: proposedCount,
    groundTruthCount: truths.length,
    alertReductionRate: 1 - proposedCount / (uniqueAlerts.length || 1),
    baseline: baselineMetrics,
    proposed: proposedMetrics,
    baselineRootTop1: baselineRootTotal ? baselineRootCorrect / baselineRootTotal : 0,
    proposedRootTop1: proposedRootTotal ? proposedRootCorrect / proposedRootTotal : 0,
    baselineMs: input.baselineMs ?? 0,
    proposedMs: input.proposedMs,
    rows,
    matching: `Each detector's alert groups — including the duplicates it suppressed — are compared with ground-truth groups using Jaccard overlap |A ∩ B| / |A ∪ B|. Pairs are matched greedily from highest to lowest overlap and count as a match at ≥ ${MATCH_THRESHOLD}. Unmatched predictions are false positives; unmatched ground truths are false negatives. Root-cause accuracy is scored only on each detector's own matched groups.`,
    matchDetail: matchDetail.sort((a, b) => b.size - a.size),
  };
}
