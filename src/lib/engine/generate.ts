import type {
  Alert,
  AlertType,
  Dataset,
  Environment,
  GroundTruthIncident,
  Severity,
} from "./types";
import { SERVICE_MAP, SERVICES } from "./services";

/** Deterministic PRNG so a seed always reproduces the same dataset. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WINDOW_MS = 6 * 60 * 60_000;
const SOURCES = ["prometheus", "cloudwatch", "datadog", "appdynamics", "synthetic-probe"];

type Draft = Omit<Alert, "id" | "fingerprint">;
type DraftWithId = Draft & { id: string };

const TYPE_FAMILY: Record<AlertType, Alert["family"]> = {
  connection_pool: "resource",
  query_latency: "latency",
  request_latency: "latency",
  error_rate: "error",
  timeout: "error",
  cpu_saturation: "resource",
  memory_saturation: "resource",
  disk_pressure: "resource",
  availability: "availability",
  certificate_expiry: "security",
  queue_backlog: "data",
  replication_lag: "data",
};

function fingerprintOf(a: {
  environment: string;
  service: string;
  type: string;
  metric: string;
}) {
  return `${a.environment}|${a.service}|${a.type}|${a.metric}`;
}

interface ScenarioAlert {
  offsetMin: number;
  service: string;
  severity: Severity;
  type: AlertType;
  metric: string;
  value: number;
  threshold: number;
  unit: string;
  description: string;
}

interface Scenario {
  id: string;
  name: string;
  environment: Environment;
  /** Minutes from window start. */
  startMin: number;
  rootCause: string;
  title: string;
  alerts: ScenarioAlert[];
  duplicates: Array<{ fromIndex: number; afterSec: number; delaySec?: number }>;
}

const NOISE_TYPES: AlertType[] = [
  "request_latency",
  "error_rate",
  "cpu_saturation",
  "memory_saturation",
  "disk_pressure",
  "queue_backlog",
  "availability",
];

const NOISE_SEVERITIES: Severity[] = [
  "low", "low", "low", "low",
  "medium", "medium", "medium",
  "high",
];

function noiseValue(type: AlertType, rnd: () => number) {
  switch (type) {
    case "request_latency":
      return { metric: "http_request_duration_p99", value: +(700 + rnd() * 1600).toFixed(0), threshold: 750, unit: "ms" };
    case "error_rate":
      return { metric: "http_error_ratio", value: +(0.6 + rnd() * 3.2).toFixed(2), threshold: 1, unit: "%" };
    case "cpu_saturation":
      return { metric: "process_cpu_usage", value: +(72 + rnd() * 22).toFixed(1), threshold: 80, unit: "%" };
    case "memory_saturation":
      return { metric: "jvm_heap_usage", value: +(70 + rnd() * 24).toFixed(1), threshold: 85, unit: "%" };
    case "disk_pressure":
      return { metric: "disk_used_ratio", value: +(74 + rnd() * 20).toFixed(1), threshold: 85, unit: "%" };
    case "queue_backlog":
      return { metric: "consumer_lag", value: +(900 + rnd() * 5200).toFixed(0), threshold: 1000, unit: "msgs" };
    case "availability":
      return { metric: "synthetic_probe_success", value: +(92 + rnd() * 6).toFixed(2), threshold: 99, unit: "%" };
    default:
      return { metric: "custom", value: 1, threshold: 1, unit: "" };
  }
}

function noiseDescription(type: AlertType, serviceName: string): string {
  switch (type) {
    case "request_latency":
      return `${serviceName} p99 latency above SLO`;
    case "error_rate":
      return `${serviceName} error budget burn elevated`;
    case "cpu_saturation":
      return `${serviceName} sustained CPU above target`;
    case "memory_saturation":
      return `${serviceName} heap pressure detected`;
    case "disk_pressure":
      return `${serviceName} node disk usage high`;
    case "queue_backlog":
      return `${serviceName} consumer lag growing`;
    case "availability":
      return `${serviceName} synthetic probe failures`;
    default:
      return `${serviceName} threshold breached`;
  }
}

const SCENARIOS: Scenario[] = [
  {
    id: "scn-db-exhaustion",
    name: "Database connection exhaustion cascade",
    environment: "production",
    startMin: 5,
    rootCause: "primary-db",
    title: "Connection pool exhaustion cascading through payments and checkout",
    alerts: [
      { offsetMin: 0, service: "primary-db", severity: "critical", type: "connection_pool", metric: "pg_stat_activity_count", value: 100, threshold: 80, unit: "conns", description: "Postgres connection pool exhausted (100/100 in use)" },
      { offsetMin: 0.9, service: "primary-db", severity: "critical", type: "query_latency", metric: "pg_query_duration_p99", value: 4820, threshold: 800, unit: "ms", description: "Primary database query p99 latency collapsed under pool starvation" },
      { offsetMin: 2.1, service: "payment-service", severity: "high", type: "timeout", metric: "payment_authorization_timeout_ratio", value: 18.4, threshold: 1, unit: "%", description: "Payment authorization timeouts — upstream DB pool saturated" },
      { offsetMin: 3.0, service: "order-service", severity: "high", type: "error_rate", metric: "order_write_error_ratio", value: 12.4, threshold: 1, unit: "%", description: "Order writes failing with connection acquisition errors" },
      { offsetMin: 4.2, service: "checkout-api", severity: "high", type: "timeout", metric: "checkout_request_timeout_ratio", value: 9.8, threshold: 1, unit: "%", description: "Checkout requests timing out waiting on order and payment services" },
      { offsetMin: 5.1, service: "primary-db", severity: "medium", type: "error_rate", metric: "pg_connection_reject_ratio", value: 4.2, threshold: 1, unit: "%", description: "Database rejecting new connection attempts" },
      { offsetMin: 6.0, service: "api-router", severity: "medium", type: "request_latency", metric: "http_request_duration_p95", value: 2140, threshold: 900, unit: "ms", description: "Router p95 latency elevated by slow checkout upstreams" },
      { offsetMin: 7.0, service: "api-gateway", severity: "high", type: "error_rate", metric: "http_5xx_ratio", value: 6.2, threshold: 1, unit: "%", description: "Gateway 5xx ratio elevated from failing checkout path" },
      { offsetMin: 8.2, service: "payment-service", severity: "critical", type: "availability", metric: "payment_authorization_availability", value: 71.4, threshold: 99.5, unit: "%", description: "Payment authorization unavailable in two regions" },
      { offsetMin: 9.4, service: "order-service", severity: "medium", type: "request_latency", metric: "http_request_duration_p95", value: 1980, threshold: 900, unit: "ms", description: "Order service p95 latency degraded" },
      { offsetMin: 10.6, service: "api-gateway", severity: "medium", type: "request_latency", metric: "http_request_duration_p95", value: 1730, threshold: 900, unit: "ms", description: "Gateway latency degraded end to end" },
      { offsetMin: 11.8, service: "checkout-api", severity: "medium", type: "error_rate", metric: "checkout_error_ratio", value: 3.1, threshold: 1, unit: "%", description: "Checkout errors persist after initial timeout burst" },
      { offsetMin: 12.9, service: "api-router", severity: "low", type: "error_rate", metric: "http_499_ratio", value: 1.4, threshold: 1, unit: "%", description: "Client aborts rising on slow checkout endpoints" },
    ],
    duplicates: [
      { fromIndex: 0, afterSec: 35 },
      { fromIndex: 0, afterSec: 95 },
      { fromIndex: 2, afterSec: 45 },
      { fromIndex: 4, afterSec: 50 },
      { fromIndex: 7, afterSec: 40, delaySec: 120 },
      { fromIndex: 8, afterSec: 60, delaySec: 90 },
    ],
  },
  {
    id: "scn-search-latency",
    name: "Upstream search latency propagation",
    environment: "production",
    startMin: 95,
    rootCause: "search-indexer",
    title: "Search indexer latency propagating to catalog and edge",
    alerts: [
      { offsetMin: 0, service: "search-indexer", severity: "medium", type: "query_latency", metric: "index_refresh_duration_p99", value: 9100, threshold: 2000, unit: "ms", description: "Search index refresh taking 9s — shard merge backlog" },
      { offsetMin: 1.2, service: "search-indexer", severity: "high", type: "request_latency", metric: "index_refresh_duration_p99", value: 14200, threshold: 2000, unit: "ms", description: "Search index refresh latency still climbing" },
      { offsetMin: 2.4, service: "search-api", severity: "high", type: "timeout", metric: "search_query_timeout_ratio", value: 9.2, threshold: 1, unit: "%", description: "Search queries timing out against stale shards" },
      { offsetMin: 3.6, service: "recommendation-service", severity: "high", type: "request_latency", metric: "recommendation_latency_p99", value: 3400, threshold: 900, unit: "ms", description: "Recommendation feature fetch blocked on search" },
      { offsetMin: 4.8, service: "product-api", severity: "medium", type: "request_latency", metric: "http_request_duration_p95", value: 1620, threshold: 750, unit: "ms", description: "Product list latency degraded via search dependency" },
      { offsetMin: 6.0, service: "web-bff", severity: "high", type: "timeout", metric: "edge_504_ratio", value: 4.6, threshold: 0.5, unit: "%", description: "Edge 504s on search-driven pages" },
      { offsetMin: 7.2, service: "mobile-bff", severity: "medium", type: "request_latency", metric: "mobile_api_latency_p95", value: 1440, threshold: 750, unit: "ms", description: "Mobile API latency degraded" },
      { offsetMin: 8.4, service: "graphql-gateway", severity: "medium", type: "request_latency", metric: "graphql_resolver_p95", value: 1510, threshold: 750, unit: "ms", description: "GraphQL resolvers slow on catalog fields" },
      { offsetMin: 9.6, service: "search-api", severity: "medium", type: "error_rate", metric: "search_error_ratio", value: 2.4, threshold: 1, unit: "%", description: "Search error ratio elevated" },
    ],
    duplicates: [
      { fromIndex: 0, afterSec: 40 },
      { fromIndex: 1, afterSec: 55 },
      { fromIndex: 2, afterSec: 45, delaySec: 150 },
      { fromIndex: 5, afterSec: 50 },
    ],
  },
  {
    id: "scn-media-saturation",
    name: "Media worker resource saturation",
    environment: "production",
    startMin: 195,
    rootCause: "image-processor",
    title: "CPU and memory saturation in the media processing group",
    alerts: [
      { offsetMin: 0, service: "image-processor", severity: "high", type: "cpu_saturation", metric: "process_cpu_usage", value: 96.4, threshold: 80, unit: "%", description: "Image processor CPU saturated on resize workers" },
      { offsetMin: 1.0, service: "video-transcoder", severity: "critical", type: "memory_saturation", metric: "jvm_heap_usage", value: 98.1, threshold: 85, unit: "%", description: "Video transcoder heap exhausted, GC thrashing" },
      { offsetMin: 2.0, service: "thumbnailer", severity: "high", type: "cpu_saturation", metric: "process_cpu_usage", value: 92.3, threshold: 80, unit: "%", description: "Thumbnailer CPU saturated by backlogged uploads" },
      { offsetMin: 3.1, service: "content-moderation", severity: "medium", type: "request_latency", metric: "moderation_latency_p99", value: 4100, threshold: 1200, unit: "ms", description: "Moderation queue drained slowly behind saturated workers" },
      { offsetMin: 4.2, service: "media-upload", severity: "high", type: "error_rate", metric: "upload_pipeline_error_ratio", value: 8.4, threshold: 1, unit: "%", description: "Upload pipeline rejecting jobs while workers are saturated" },
      { offsetMin: 5.3, service: "content-moderation", severity: "high", type: "timeout", metric: "moderation_timeout_ratio", value: 3.8, threshold: 1, unit: "%", description: "Moderation requests timing out" },
      { offsetMin: 6.4, service: "media-upload", severity: "low", type: "queue_backlog", metric: "upload_job_lag", value: 3400, threshold: 1000, unit: "jobs", description: "Upload job backlog growing" },
    ],
    duplicates: [
      { fromIndex: 0, afterSec: 35 },
      { fromIndex: 2, afterSec: 40, delaySec: 110 },
      { fromIndex: 4, afterSec: 45 },
    ],
  },
  {
    id: "scn-cert-isolated",
    name: "Isolated certificate expiry",
    environment: "production",
    startMin: 295,
    rootCause: "secrets-broker",
    title: "TLS certificate expiring on secrets broker",
    alerts: [
      { offsetMin: 0, service: "secrets-broker", severity: "critical", type: "certificate_expiry", metric: "tls_certificate_days_left", value: 1.5, threshold: 14, unit: "days", description: "TLS certificate for secrets-broker expires in 36 hours" },
    ],
    duplicates: [{ fromIndex: 0, afterSec: 45 }],
  },
  {
    id: "scn-replica-lag",
    name: "Staging replica replication lag",
    environment: "staging",
    startMin: 140,
    rootCause: "replica-db",
    title: "Read replica lag degrading read-path services",
    alerts: [
      { offsetMin: 0, service: "replica-db", severity: "critical", type: "replication_lag", metric: "pg_replication_lag", value: 420, threshold: 30, unit: "s", description: "Read replica replication lag at 7 minutes" },
      { offsetMin: 1.3, service: "search-api", severity: "high", type: "timeout", metric: "search_query_timeout_ratio", value: 5.4, threshold: 1, unit: "%", description: "Search reads timing out on lagging replica" },
      { offsetMin: 2.4, service: "reporting-api", severity: "medium", type: "request_latency", metric: "report_latency_p99", value: 2600, threshold: 1000, unit: "ms", description: "Reporting queries slow on stale replica" },
      { offsetMin: 3.5, service: "catalog-service", severity: "medium", type: "request_latency", metric: "catalog_read_p95", value: 1320, threshold: 700, unit: "ms", description: "Catalog reads degraded" },
      { offsetMin: 4.6, service: "metrics-aggregator", severity: "medium", type: "query_latency", metric: "rollup_query_duration_p99", value: 1980, threshold: 900, unit: "ms", description: "Metric rollups slow against replica" },
      { offsetMin: 5.7, service: "dashboard-api", severity: "medium", type: "timeout", metric: "dashboard_timeout_ratio", value: 2.2, threshold: 0.5, unit: "%", description: "Dashboards timing out" },
    ],
    duplicates: [
      { fromIndex: 0, afterSec: 40 },
      { fromIndex: 2, afterSec: 50, delaySec: 130 },
    ],
  },
];

export function generateDataset(seed: number): Dataset {
  const rnd = mulberry32(seed);
  const windowEnd = Math.ceil(Date.now() / 300_000) * 300_000;
  const windowStart = windowEnd - WINDOW_MS;
  const minToTs = (min: number) => windowStart + Math.round(min * 60_000);

  const drafts: Draft[] = [];
  const groundTruth: GroundTruthIncident[] = [];
  /** Busy windows per environment: scenario activity padded by 16 minutes. */
  const busy: Record<Environment, Array<[number, number]>> = {
    production: [],
    staging: [],
    development: [],
  };

  for (const scenario of SCENARIOS) {
    const ids: string[] = [];
    scenario.alerts.forEach((a, index) => {
      const ts = minToTs(scenario.startMin + a.offsetMin);
      const draft: Draft = {
        ts,
        service: a.service,
        environment: scenario.environment,
        severity: a.severity,
        type: a.type,
        family: TYPE_FAMILY[a.type],
        metric: a.metric,
        value: a.value,
        threshold: a.threshold,
        unit: a.unit,
        description: a.description,
        source: SOURCES[Math.floor(rnd() * SOURCES.length)],
        scenarioId: scenario.id,
      };
      drafts.push(draft);
      // id assigned below, so track by identity
      ids.push(`${drafts.length - 1}`);
      busy[scenario.environment].push([ts - 20 * 60_000, ts + 20 * 60_000]);
      for (const dup of scenario.duplicates) {
        if (dup.fromIndex !== index) continue;
        drafts.push({
          ...draft,
          ts: ts + dup.afterSec * 1000,
          ingestDelayMs: dup.delaySec ? dup.delaySec * 1000 : undefined,
        });
      }
    });
    const alertIdsForScenario = ids; // replaced with real ids after assignment
    groundTruth.push({
      id: `GT-${groundTruth.length + 1}`,
      title: scenario.title,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      alertIds: alertIdsForScenario,
      rootCause: scenario.rootCause,
      environment: scenario.environment,
    });
  }

  // ---- Background noise bursts -------------------------------------------
  // Each burst is one service emitting repeated firings of one alert rule,
  // plus a couple of near-identical duplicates. Bursts per environment are
  // spaced on a grid so unrelated services never fall inside the temporal
  // gate of each other — matching how isolated background noise behaves.
  const slotMin = 7;
  const available = new Map<Environment, string[]>();
  for (const env of ["production", "staging", "development"] as Environment[]) {
    const pool = SERVICES.map((s) => s.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    available.set(env, pool);
  }

  let noiseGroup = 0;
  for (let slot = 10; slot <= 345 && noiseGroup < 180; slot += slotMin) {
    for (const env of ["production", "staging", "development"] as Environment[]) {
      const start = minToTs(slot);
      const end = start + 4 * 60_000;
      const clash = busy[env].some(([s, e]) => start < e && end > s);
      if (clash) continue;
      const service = available.get(env)!.pop();
      if (!service) continue;
      noiseGroup += 1;

      const type = NOISE_TYPES[Math.floor(rnd() * NOISE_TYPES.length)];
      const severity = NOISE_SEVERITIES[Math.floor(rnd() * NOISE_SEVERITIES.length)];
      const measured = noiseValue(type, rnd);
      const serviceName = SERVICE_MAP[service].name;
      const base: Draft = {
        ts: start,
        service,
        environment: env,
        severity,
        type,
        family: TYPE_FAMILY[type],
        metric: measured.metric,
        value: measured.value,
        threshold: measured.threshold,
        unit: measured.unit,
        description: noiseDescription(type, serviceName),
        source: SOURCES[Math.floor(rnd() * SOURCES.length)],
      };
      drafts.push(base);
      drafts.push({
        ...base,
        ts: start + (38 + Math.floor(rnd() * 30)) * 1000,
        ingestDelayMs: rnd() < 0.25 ? 90_000 : undefined,
      });
      const second = { ...base, ts: start + 3 * 60_000, value: +(base.value * 1.08).toFixed(2) };
      drafts.push(second);
      drafts.push({ ...second, ts: second.ts + 30_000 });
    }
  }

  // ---- Final assembly ----------------------------------------------------
  // Out-of-order ingestion is the normal case: shuffle deterministically.
  for (let i = drafts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [drafts[i], drafts[j]] = [drafts[j], drafts[i]];
  }

  const alerts: DraftWithId[] = drafts.map((d, i) => ({
    ...d,
    id: `ALT-${String(i + 1).padStart(4, "0")}`,
  }));

  // Repair ground-truth alert id lists (indices above tracked draft order).
  const fixedGroundTruth = groundTruth.map((g) => ({
    ...g,
    alertIds: alerts.filter((a) => a.scenarioId === g.scenarioId).map((a) => a.id),
  }));

  // Noise ground truth: one incident per burst = same service+type+env within
  // the burst, identified by grouping non-scenario alerts by that key.
  const noiseBuckets = new Map<string, string[]>();
  for (const a of alerts) {
    if (a.scenarioId) continue;
    const key = `${a.environment}|${a.service}|${a.type}|${a.metric}`;
    const bucket = noiseBuckets.get(key) ?? [];
    bucket.push(a.id);
    noiseBuckets.set(key, bucket);
  }
  let noiseIndex = 0;
  for (const [key, ids] of noiseBuckets) {
    const [environment, service, type] = key.split("|") as [Environment, string, AlertType];
    noiseIndex += 1;
    fixedGroundTruth.push({
      id: `GT-N${noiseIndex}`,
      title: `${SERVICE_MAP[service].name}: ${noiseDescription(type, SERVICE_MAP[service].name)}`,
      scenarioId: `noise-${noiseIndex}`,
      scenarioName: "Background noise",
      alertIds: ids,
      rootCause: service,
      environment,
    });
  }

  return {
    seed,
    createdAt: Date.now(),
    windowStart,
    windowEnd,
    alerts: alerts.map((a) => ({ ...a, fingerprint: fingerprintOf(a) })),
    groundTruth: fixedGroundTruth,
  };
}

export const WINDOW_HOURS = WINDOW_MS / 3_600_000;
