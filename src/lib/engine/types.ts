export type Environment = "production" | "staging" | "development";

export const ENVIRONMENTS: Environment[] = ["production", "staging", "development"];

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export type AlertFamily =
  | "resource"
  | "latency"
  | "error"
  | "availability"
  | "security"
  | "data";

export type AlertType =
  | "connection_pool"
  | "query_latency"
  | "request_latency"
  | "error_rate"
  | "timeout"
  | "cpu_saturation"
  | "memory_saturation"
  | "disk_pressure"
  | "availability"
  | "certificate_expiry"
  | "queue_backlog"
  | "replication_lag";

export interface Alert {
  /** Stable synthetic id, e.g. ALT-0001 */
  id: string;
  /** Event timestamp (ms since epoch), may arrive out of order. */
  ts: number;
  /** Optional ingestion delay in ms — explains late/duplicate delivery. */
  ingestDelayMs?: number;
  service: string;
  environment: Environment;
  severity: Severity;
  type: AlertType;
  family: AlertFamily;
  metric: string;
  value: number;
  threshold: number;
  unit: string;
  description: string;
  source: string;
  /** env|service|type|metric — used for deduplication. */
  fingerprint: string;
  /** Ground truth only. Never read by the correlation engine. */
  scenarioId?: string;
}

export interface DuplicateRecord {
  alert: Alert;
  /** Alert id of the earliest event sharing this fingerprint. */
  duplicateOf: string;
  /** Seconds between the duplicate and its canonical alert. */
  deltaSeconds: number;
  /** Incident id the canonical alert ended up in, when known. */
  incidentId?: string;
}

export interface ServiceDef {
  id: string;
  name: string;
  domain: string;
  tier: number;
  /** Upstream services this one calls. */
  deps: string[];
  language: string;
  owner: string;
}

export interface GroundTruthIncident {
  id: string;
  title: string;
  scenarioId: string;
  scenarioName: string;
  alertIds: string[];
  rootCause: string;
  environment: Environment;
}

export interface Dataset {
  seed: number;
  createdAt: number;
  /** Window start (ms) — alerts span 6h from here. */
  windowStart: number;
  windowEnd: number;
  alerts: Alert[];
  groundTruth: GroundTruthIncident[];
}

export interface CorrelationConfig {
  /** Alerts older than this from the incident's last event cannot join it. */
  timeWindowMs: number;
  /** Identical fingerprints inside this window collapse to one alert. */
  dedupWindowMs: number;
  /** Cross-service joins require an alert this close to a group member. */
  temporalGateMs: number;
  /** Max dependency hops considered a "related" service. */
  maxGraphHops: number;
  /** Score needed for an alert to join an existing incident. */
  joinThreshold: number;
}

export const DEFAULT_CONFIG: CorrelationConfig = {
  timeWindowMs: 15 * 60_000,
  dedupWindowMs: 2 * 60_000,
  temporalGateMs: 3 * 60_000,
  maxGraphHops: 2,
  joinThreshold: 5,
};

export interface RuleEvidence {
  rule: string;
  detail: string;
  score: number;
  /** When true the rule alone blocked the join regardless of score. */
  gate?: boolean;
}

export interface RejectedJoin {
  incidentId: string;
  score: number;
  threshold: number;
  reasons: RuleEvidence[];
}

export type Attention = "action" | "review" | "ignore";

export interface AlertDecision {
  alertId: string;
  incidentId: string | null;
  /** Present when the alert was suppressed as a duplicate. */
  duplicateOf?: string;
  attention: Attention;
  signalScore: number;
  attentionReason: string;
  /** Winning rules that grouped this alert into its incident. */
  matched: RuleEvidence[];
  /** Best incident that was considered but rejected, with the reason. */
  rejected?: RejectedJoin;
}

export type IncidentStatus = "open" | "acknowledged" | "resolved";

export interface RootCauseSignal {
  label: string;
  detail: string;
  points: number;
}

export interface RootCauseCandidate {
  service: string;
  score: number;
  signals: RootCauseSignal[];
  /** Ground-truth root cause, used only by the evaluation view. */
  isGroundTruth?: boolean;
}

export interface TimelineEvent {
  ts: number;
  kind: "first" | "alert" | "duplicate" | "status";
  service?: string;
  text: string;
  severity?: Severity;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  startTs: number;
  lastTs: number;
  services: string[];
  alertIds: string[];
  duplicateIds: string[];
  /** Aggregated correlation rules, most frequent first. */
  evidence: string[];
  rootCauses: RootCauseCandidate[];
  probableRootCause: string;
  timeline: TimelineEvent[];
  environments: Environment[];
  alertCount: number;
  suppressedCount: number;
}

export interface AnalysisResult {
  config: CorrelationConfig;
  rawAlertCount: number;
  uniqueAlertCount: number;
  duplicateCount: number;
  incidents: Incident[];
  decisions: Record<string, AlertDecision>;
  /** Duplicates grouped with their canonical alert's incident. */
  duplicateIncident: Record<string, string | undefined>;
  /** Measured wall-clock time of the correlation pass. */
  durationMs: number;
  runAt: number;
}

export interface MetricPair {
  label: string;
  definition: string;
  baseline: number;
  proposed: number;
  higherIsBetter: boolean;
  format: "number" | "percent" | "ms";
}

export interface EvaluationResult {
  scopeLabel: string;
  rawAlertCount: number;
  uniqueAlertCount: number;
  baselineIncidentCount: number;
  proposedIncidentCount: number;
  groundTruthCount: number;
  alertReductionRate: number;
  baseline: MatchMetrics;
  proposed: MatchMetrics;
  baselineRootTop1: number;
  proposedRootTop1: number;
  baselineMs: number;
  proposedMs: number;
  rows: MetricPair[];
  matching: string;
  /** Per-incident match rows for the detail table. */
  matchDetail: MatchDetail[];
}

export interface MatchMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface MatchDetail {
  groundTruthId: string;
  title: string;
  scenarioName: string;
  rootCause: string;
  predictedId: string | null;
  predictedTitle: string | null;
  overlap: number;
  rootCorrect: boolean | null;
  size: number;
}
