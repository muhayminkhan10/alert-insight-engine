import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { deduplicate, runAnalysis } from "./engine/correlate";
import { explainIncident, type IncidentExplanation } from "./engine/explain";
import { evaluate } from "./engine/evaluate";
import { generateDataset } from "./engine/generate";
import {
  DEFAULT_CONFIG,
  type Alert,
  type AnalysisResult,
  type CorrelationConfig,
  type Dataset,
  type Environment,
  type EvaluationResult,
  type Incident,
  type IncidentStatus,
} from "./engine/types";

export const DEFAULT_SEED = 20261028;

export type EnvScope = Environment | "all";

export interface ActivityItem {
  ts: number;
  kind: "generate" | "analysis" | "status" | "ai" | "config";
  text: string;
}

export interface ExplanationState {
  status: "idle" | "loading" | "ready";
  explanation?: IncidentExplanation;
}

interface StoreValue {
  seed: number;
  dataset: Dataset;
  config: CorrelationConfig;
  envScope: EnvScope;
  analysis: AnalysisResult;
  incidents: Incident[];
  scopedAlerts: Alert[];
  evaluation: EvaluationResult;
  heldOut: boolean;
  activity: ActivityItem[];
  stale: boolean;
  explanations: Record<string, ExplanationState>;
  incidentById: (id: string) => Incident | undefined;
  generateFresh: () => void;
  resetDemo: () => void;
  setConfig: (patch: Partial<CorrelationConfig>) => void;
  setEnvScope: (scope: EnvScope) => void;
  runAnalysisNow: () => void;
  setStatus: (incidentId: string, status: IncidentStatus) => void;
  explain: (incidentId: string) => void;
  toggleHeldOut: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function log(
  prev: ActivityItem[],
  kind: ActivityItem["kind"],
  text: string,
): ActivityItem[] {
  return [{ ts: Date.now(), kind, text }, ...prev].slice(0, 40);
}

function scopeAlerts(dataset: Dataset, scope: EnvScope): Alert[] {
  if (scope === "all") return dataset.alerts;
  return dataset.alerts.filter((a) => a.environment === scope);
}

function scopeTruth(dataset: Dataset, alerts: Alert[]) {
  const ids = new Set(alerts.map((a) => a.id));
  return dataset.groundTruth
    .map((g) => ({ ...g, alertIds: g.alertIds.filter((id) => ids.has(id)) }))
    .filter((g) => g.alertIds.length > 0);
}

/** Pull structured JSON out of a model response, tolerating code fences. */
function parseModelJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const explainAction = useAction(api.ai.explainIncident);

  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [dataset, setDataset] = useState<Dataset>(() => generateDataset(DEFAULT_SEED));
  const [config, setConfigState] = useState<CorrelationConfig>(DEFAULT_CONFIG);
  const [envScope, setEnvScopeState] = useState<EnvScope>("all");
  const [runNonce, setRunNonce] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, IncidentStatus>>({});
  const [activity, setActivity] = useState<ActivityItem[]>([
    { ts: Date.now(), kind: "generate", text: `Seeded synthetic dataset #${DEFAULT_SEED}` },
  ]);
  const [explanations, setExplanations] = useState<Record<string, ExplanationState>>({});
  const [heldOut, setHeldOut] = useState(false);
  const [configSignature, setConfigSignature] = useState<string>("");

  const scopedAlerts = useMemo(() => scopeAlerts(dataset, envScope), [dataset, envScope]);
  const scopedTruth = useMemo(() => scopeTruth(dataset, scopedAlerts), [dataset, scopedAlerts]);

  const analysis = useMemo(
    () => runAnalysis(scopedAlerts, config),
    [scopedAlerts, config, runNonce],
  );

  const signature = useMemo(
    () => JSON.stringify({ seed, envScope, config }),
    [seed, envScope, config],
  );

  const incidents = useMemo(
    () =>
      analysis.incidents.map((i) => ({
        ...i,
        status: statuses[i.id] ?? i.status,
      })),
    [analysis, statuses],
  );

  const evaluation = useMemo(() => {
    const heldDataset = heldOut ? generateDataset(seed + 977) : null;
    const alerts = heldOut ? heldDataset!.alerts : scopedAlerts;
    const truths = heldOut ? heldDataset!.groundTruth : scopedTruth;
    const result = heldOut ? runAnalysis(alerts, config) : analysis;
    // The baseline only deduplicates, then emits one incident per unique alert.
    const t0 = performance.now();
    deduplicate(alerts, config);
    const baselineMs = +(performance.now() - t0).toFixed(2);
    return evaluate({
      alerts,
      groundTruth: truths,
      config,
      proposed: result.incidents,
      proposedMs: result.durationMs,
      baselineMs,
      scopeLabel: heldOut
        ? `Held-out dataset, seed ${seed + 977}`
        : `Dataset #${seed}, ${envScope === "all" ? "all environments" : envScope}`,
    });
  }, [heldOut, seed, scopedAlerts, scopedTruth, config, analysis, envScope]);

  const incidentById = useCallback(
    (id: string) => incidents.find((i) => i.id === id),
    [incidents],
  );

  const generateFresh = useCallback(() => {
    const next = Math.floor(100000 + Math.random() * 899999);
    const nextDataset = generateDataset(next);
    setSeed(next);
    setDataset(nextDataset);
    setStatuses({});
    setExplanations({});
    setRunNonce((n) => n + 1);
    setConfigSignature(JSON.stringify({ seed: next, envScope, config }));
    setActivity((prev) =>
      log(prev, "generate", `Generated dataset #${next} — ${nextDataset.alerts.length} raw alerts`),
    );
  }, [envScope, config]);

  const resetDemo = useCallback(() => {
    const nextDataset = generateDataset(DEFAULT_SEED);
    setSeed(DEFAULT_SEED);
    setDataset(nextDataset);
    setStatuses({});
    setExplanations({});
    setRunNonce((n) => n + 1);
    setConfigSignature(JSON.stringify({ seed: DEFAULT_SEED, envScope, config }));
    setActivity((prev) => log(prev, "generate", `Reset demo to seed #${DEFAULT_SEED}`));
  }, [envScope, config]);

  const setConfig = useCallback(
    (patch: Partial<CorrelationConfig>) => {
      setConfigState((prev) => ({ ...prev, ...patch }));
      setActivity((prev) =>
        log(prev, "config", `Correlation window settings changed — ${Object.keys(patch).join(", ")}`),
      );
    },
    [],
  );

  const setEnvScope = useCallback((scope: EnvScope) => {
    setEnvScopeState(scope);
    setActivity((prev) =>
      log(prev, "config", `Scope set to ${scope === "all" ? "all environments" : scope}`),
    );
  }, []);

  const runAnalysisNow = useCallback(() => {
    setConfigSignature(JSON.stringify({ seed, envScope, config }));
    setRunNonce((n) => n + 1);
    setActivity((prev) =>
      log(prev, "analysis", `Analysis queued for ${scopedAlerts.length} alerts`),
    );
  }, [seed, envScope, config, scopedAlerts.length]);

  const setStatus = useCallback((incidentId: string, status: IncidentStatus) => {
    setStatuses((prev) => ({ ...prev, [incidentId]: status }));
    setActivity((prev) => log(prev, "status", `${incidentId} marked ${status}`));
  }, []);

  const explain = useCallback(
    (incidentId: string) => {
      const incident = incidents.find((i) => i.id === incidentId);
      if (!incident) return;
      const fallback = () => {
        const deterministic = explainIncident(
          incident,
          scopedAlerts,
          "deterministic",
          true,
        );
        setExplanations((prev) => ({
          ...prev,
          [incidentId]: { status: "ready", explanation: deterministic },
        }));
        setActivity((prev) =>
          log(prev, "ai", `${incidentId} explained by deterministic generator (model unavailable)`),
        );
      };

      setExplanations((prev) => ({ ...prev, [incidentId]: { status: "loading" } }));

      const alerts = scopedAlerts
        .filter((a) => incident.alertIds.includes(a.id))
        .sort((a, b) => a.ts - b.ts)
        .map((a) => ({
          ts: a.ts,
          service: a.service,
          severity: a.severity,
          type: a.type,
          description: a.description,
        }));

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 9000),
      );

      Promise.race([
        explainAction({
          title: incident.title,
          severity: incident.severity,
          services: incident.services,
          rootCause: incident.probableRootCause,
          evidence: incident.evidence.slice(0, 8),
          candidates: incident.rootCauses.slice(0, 4).map((c) => ({
            service: c.service,
            score: c.score,
            signals: c.signals.map((s) => `${s.label}: ${s.detail}`),
          })),
          alerts,
        }),
        timeout,
      ])
        .then((res) => {
          if (!res?.ok || !res.text) {
            fallback();
            return;
          }
          try {
            const parsed = parseModelJson(res.text) as {
              summary?: string;
              hypotheses?: Array<{ service: string; supporting?: string[]; counter?: string }>;
              steps?: string[];
            };
            const allowed = new Set(incident.services);
            const hypotheses = (parsed.hypotheses ?? [])
              .filter((h) => h && allowed.has(h.service))
              .map((h, index) => {
                const ranked = incident.rootCauses.find((c) => c.service === h.service);
                return {
                  service: h.service,
                  rank: index + 1,
                  score: ranked?.score ?? 0,
                  supporting: h.supporting ?? ranked?.signals.map((s) => s.detail) ?? [],
                  counter: h.counter ?? "",
                };
              });
            const base = explainIncident(incident, scopedAlerts, "deterministic");
            if (!parsed.summary || !hypotheses.length) {
              fallback();
              return;
            }
            const explanation: IncidentExplanation = {
              summary: parsed.summary,
              hypotheses,
              steps: parsed.steps?.length ? parsed.steps : base.steps,
              generator: "ai",
            };
            setExplanations((prev) => ({
              ...prev,
              [incidentId]: { status: "ready", explanation },
            }));
            setActivity((prev) =>
              log(prev, "ai", `${incidentId} explanation generated by ${res.source === "gemini" ? "Gemini" : "the AI model"}`),
            );
          } catch {
            fallback();
          }
        })
        .catch(() => fallback());
    },
    [incidents, scopedAlerts, explainAction],
  );

  const toggleHeldOut = useCallback(() => setHeldOut((h) => !h), []);

  const value: StoreValue = {
    seed,
    dataset,
    config,
    envScope,
    analysis,
    incidents,
    scopedAlerts,
    evaluation,
    heldOut,
    activity,
    stale: signature !== (configSignature || signature),
    explanations,
    incidentById,
    generateFresh,
    resetDemo,
    setConfig,
    setEnvScope,
    runAnalysisNow,
    setStatus,
    explain,
    toggleHeldOut,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
