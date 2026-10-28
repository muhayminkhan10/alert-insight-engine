import type { ServiceDef } from "./types";

/**
 * 70 simulated microservices. `deps` lists the upstream services each one
 * calls, so a failure on a dependency propagates to its dependents.
 */
const RAW: Array<[string, string, string, number, string[], string, string]> = [
  // edge
  ["web-bff", "Web BFF", "edge", 0, ["api-gateway", "auth-service", "product-api", "recommendation-service"], "typescript", "web-platform"],
  ["mobile-bff", "Mobile BFF", "edge", 0, ["api-gateway", "auth-service", "product-api"], "typescript", "mobile-platform"],
  ["cdn-edge-router", "CDN Edge Router", "edge", 0, ["asset-cdn", "api-gateway"], "go", "edge"],
  ["public-api-gateway", "Public API Gateway", "edge", 0, ["rate-limiter", "api-gateway"], "go", "edge"],
  ["graphql-gateway", "GraphQL Gateway", "edge", 0, ["api-router", "product-api", "user-profile"], "typescript", "web-platform"],
  ["websocket-gateway", "WebSocket Gateway", "edge", 0, ["kafka-broker", "session-service"], "go", "realtime"],
  // gateway
  ["api-gateway", "API Gateway", "gateway", 1, ["rate-limiter", "auth-service", "request-validator", "api-router"], "go", "edge"],
  ["rate-limiter", "Rate Limiter", "gateway", 1, ["rate-limit-store", "redis-cache"], "go", "edge"],
  ["auth-service", "Auth Service", "gateway", 1, ["session-service", "primary-db", "secrets-broker"], "go", "identity"],
  ["session-service", "Session Service", "gateway", 1, ["session-cache", "redis-cache"], "go", "identity"],
  ["api-router", "API Router", "gateway", 1, ["checkout-api", "product-api", "payment-service", "user-profile", "search-api"], "go", "edge"],
  ["request-validator", "Request Validator", "gateway", 1, ["config-service", "feature-flag-service"], "rust", "edge"],
  // payments
  ["payment-service", "Payment Service", "payments", 2, ["payment-orchestrator", "redis-cache", "primary-db", "fraud-detection"], "java", "payments"],
  ["payment-orchestrator", "Payment Orchestrator", "payments", 2, ["billing-core", "primary-db", "kafka-broker", "fraud-detection"], "java", "payments"],
  ["billing-core", "Billing Core", "payments", 2, ["primary-db", "invoicing-service", "audit-log"], "java", "payments"],
  ["invoicing-service", "Invoicing Service", "payments", 2, ["primary-db", "notification-service"], "java", "payments"],
  ["refund-service", "Refund Service", "payments", 2, ["payment-orchestrator", "billing-core", "primary-db"], "java", "payments"],
  ["fraud-detection", "Fraud Detection", "payments", 2, ["feature-flag-service", "redis-cache", "primary-db"], "python", "payments"],
  ["currency-converter", "Currency Converter", "payments", 2, ["redis-cache", "config-service"], "python", "payments"],
  // orders
  ["order-service", "Order Service", "orders", 2, ["primary-db", "kafka-broker", "order-workflow", "inventory-service"], "java", "orders"],
  ["checkout-api", "Checkout API", "orders", 2, ["cart-service", "order-service", "payment-service", "pricing-engine"], "java", "orders"],
  ["order-workflow", "Order Workflow", "orders", 2, ["kafka-broker", "queue-worker", "primary-db"], "java", "orders"],
  ["cart-service", "Cart Service", "orders", 2, ["redis-cache", "primary-db", "session-cache"], "typescript", "orders"],
  ["pricing-engine", "Pricing Engine", "orders", 2, ["redis-cache", "promotion-service", "primary-db"], "rust", "orders"],
  ["promotion-service", "Promotion Service", "orders", 2, ["primary-db", "config-service"], "rust", "orders"],
  // catalog
  ["product-api", "Product API", "catalog", 2, ["catalog-service", "inventory-service", "redis-cache", "primary-db"], "typescript", "catalog"],
  ["catalog-service", "Catalog Service", "catalog", 2, ["primary-db", "replica-db", "search-indexer"], "typescript", "catalog"],
  ["inventory-service", "Inventory Service", "catalog", 2, ["primary-db", "stock-reservation", "kafka-broker"], "go", "catalog"],
  ["stock-reservation", "Stock Reservation", "catalog", 2, ["primary-db", "kafka-broker"], "go", "catalog"],
  ["search-api", "Search API", "catalog", 2, ["search-indexer", "replica-db", "redis-cache"], "rust", "search"],
  ["search-indexer", "Search Indexer", "catalog", 2, ["kafka-broker", "primary-db", "replica-db"], "rust", "search"],
  ["recommendation-service", "Recommendation Service", "catalog", 2, ["search-indexer", "event-collector", "redis-cache", "replica-db"], "python", "ml"],
  ["category-service", "Category Service", "catalog", 2, ["primary-db", "catalog-service"], "typescript", "catalog"],
  // users
  ["user-profile", "User Profile", "users", 2, ["primary-db", "redis-cache"], "typescript", "identity"],
  ["account-service", "Account Service", "users", 2, ["primary-db", "user-profile", "audit-log"], "go", "identity"],
  ["notification-service", "Notification Service", "users", 2, ["kafka-broker", "email-dispatcher", "sms-gateway", "preferences-service"], "go", "messaging"],
  ["email-dispatcher", "Email Dispatcher", "users", 2, ["kafka-broker", "config-service"], "go", "messaging"],
  ["sms-gateway", "SMS Gateway", "users", 2, ["kafka-broker", "config-service"], "go", "messaging"],
  ["preferences-service", "Preferences Service", "users", 2, ["primary-db", "user-profile"], "typescript", "identity"],
  // content
  ["media-upload", "Media Upload", "content", 2, ["primary-db", "image-processor", "asset-cdn", "kafka-broker"], "go", "media"],
  ["image-processor", "Image Processor", "content", 3, ["thumbnailer", "redis-cache", "asset-cdn"], "python", "media"],
  ["video-transcoder", "Video Transcoder", "content", 3, ["asset-cdn", "queue-worker"], "python", "media"],
  ["content-moderation", "Content Moderation", "content", 3, ["image-processor", "primary-db", "queue-worker"], "python", "media"],
  ["asset-cdn", "Asset CDN", "content", 2, ["config-service"], "go", "media"],
  ["thumbnailer", "Thumbnailer", "content", 3, ["redis-cache", "asset-cdn"], "python", "media"],
  // analytics
  ["event-collector", "Event Collector", "analytics", 2, ["kafka-broker", "stream-processor"], "go", "data"],
  ["stream-processor", "Stream Processor", "analytics", 3, ["kafka-broker", "data-warehouse-loader", "metrics-aggregator"], "java", "data"],
  ["metrics-aggregator", "Metrics Aggregator", "analytics", 3, ["replica-db", "kafka-broker"], "java", "data"],
  ["data-warehouse-loader", "Data Warehouse Loader", "analytics", 3, ["replica-db", "primary-db"], "java", "data"],
  ["reporting-api", "Reporting API", "analytics", 2, ["replica-db", "metrics-aggregator"], "typescript", "data"],
  ["dashboard-api", "Dashboard API", "analytics", 2, ["reporting-api", "redis-cache", "feature-flag-service"], "typescript", "data"],
  // platform
  ["primary-db", "Primary Postgres", "platform", 3, [], "sql", "database"],
  ["replica-db", "Read Replica", "platform", 3, ["primary-db"], "sql", "database"],
  ["redis-cache", "Redis Cache", "platform", 3, [], "redis", "database"],
  ["session-cache", "Session Cache", "platform", 3, ["redis-cache"], "redis", "database"],
  ["kafka-broker", "Kafka Broker", "platform", 3, ["config-service"], "jvm", "streaming"],
  ["queue-worker", "Queue Worker", "platform", 3, ["kafka-broker", "primary-db"], "go", "streaming"],
  ["job-scheduler", "Job Scheduler", "platform", 3, ["kafka-broker", "queue-worker"], "go", "streaming"],
  ["feature-flag-service", "Feature Flag Service", "platform", 2, ["config-service", "redis-cache"], "go", "platform"],
  ["config-service", "Config Service", "platform", 2, ["secrets-broker"], "go", "platform"],
  ["secrets-broker", "Secrets Broker", "platform", 2, [], "rust", "platform"],
  ["service-mesh-proxy", "Service Mesh Proxy", "platform", 1, ["config-service"], "envoy", "platform"],
  ["log-aggregator", "Log Aggregator", "platform", 3, ["kafka-broker", "replica-db"], "go", "observability"],
  ["trace-collector", "Trace Collector", "platform", 3, ["kafka-broker", "replica-db"], "go", "observability"],
  ["rate-limit-store", "Rate Limit Store", "platform", 3, ["redis-cache"], "redis", "edge"],
  // support
  ["geo-ip-resolver", "Geo IP Resolver", "support", 2, ["redis-cache", "config-service"], "rust", "support"],
  ["translation-service", "Translation Service", "support", 2, ["redis-cache", "config-service"], "python", "support"],
  ["experiment-service", "Experiment Service", "support", 2, ["feature-flag-service", "primary-db"], "go", "growth"],
  ["ab-testing", "A/B Testing", "support", 2, ["experiment-service", "feature-flag-service"], "go", "growth"],
  ["audit-log", "Audit Log", "support", 2, ["kafka-broker", "primary-db"], "go", "platform"],
];

export const SERVICES: ServiceDef[] = RAW.map(([id, name, domain, tier, deps, language, owner]) => ({
  id,
  name,
  domain,
  tier,
  deps,
  language,
  owner,
}));

export const SERVICE_MAP: Record<string, ServiceDef> = Object.fromEntries(
  SERVICES.map((s) => [s.id, s]),
);

/** service -> services that call it (downstream dependents). */
export const DEPENDENTS: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const s of SERVICES) {
    for (const dep of s.deps) {
      (map[dep] ??= []).push(s.id);
    }
  }
  return map;
})();

const adjacency = new Map<string, string[]>();
for (const s of SERVICES) {
  const neighbors = new Set<string>(s.deps);
  for (const dep of s.deps) for (const d2 of DEPENDENTS[dep] ?? []) neighbors.add(d2);
  adjacency.set(s.id, [...neighbors]);
}

/** Shortest undirected dependency distance between two services, capped at maxHops. */
export function graphDistance(
  from: string,
  to: string,
  maxHops: number,
  cache: Map<string, number> = new Map(),
): number {
  if (from === to) return 0;
  const key = `${from}>${to}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const visited = new Set<string>([from]);
  let frontier = [from];
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (neighbor === to) {
          cache.set(key, hop);
          return hop;
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  cache.set(key, Infinity);
  return Infinity;
}

/** Transitive upstream dependencies (services this one calls, transitively). */
export function ancestors(service: string, maxHops = 4): string[] {
  const out: string[] = [];
  const visited = new Set<string>([service]);
  let frontier = [service];
  for (let hop = 0; hop < maxHops; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const dep of SERVICE_MAP[node]?.deps ?? []) {
        if (!visited.has(dep)) {
          visited.add(dep);
          out.push(dep);
          next.push(dep);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return out;
}

/** Transitive downstream dependents (services that call this one, transitively). */
export function descendants(service: string, maxHops = 4): string[] {
  const out: string[] = [];
  const visited = new Set<string>([service]);
  let frontier = [service];
  for (let hop = 0; hop < maxHops; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const dep of DEPENDENTS[node] ?? []) {
        if (!visited.has(dep)) {
          visited.add(dep);
          out.push(dep);
          next.push(dep);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return out;
}

export const EDGES: Array<{ from: string; to: string }> = SERVICES.flatMap((s) =>
  s.deps.map((dep) => ({ from: s.id, to: dep })),
);

export function serviceName(id: string): string {
  return SERVICE_MAP[id]?.name ?? id;
}
