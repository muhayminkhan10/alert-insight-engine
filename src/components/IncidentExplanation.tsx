import { SectionCard } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { SERVICE_MAP } from "@/lib/engine/services";
import { AlertTriangle, Loader2, Sparkles, Workflow } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

/**
 * AI explanation panel. The model output is always framed as hypotheses and
 * is never allowed to change grouping — it only narrates what the engine
 * already decided. Falls back to the deterministic generator when no model
 * is reachable.
 */
export function IncidentExplanation({ incidentId }: { incidentId: string }) {
  const { explanations, explain, incidentById } = useStore();
  const state = explanations[incidentId];
  const incident = incidentById(incidentId);
  const [showEvidence, setShowEvidence] = useState(true);
  if (!incident) return null;

  const explanation = state?.explanation;

  return (
    <SectionCard
      title="AI incident explanation"
      description="Narrative over evidence the engine already collected — no grouping is changed by the model"
      actions={
        <Button
          size="sm"
          variant={explanation ? "outline" : "default"}
          className="h-7 gap-1.5 text-[11px]"
          disabled={state?.status === "loading"}
          onClick={() => explain(incidentId)}
        >
          {state?.status === "loading" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" strokeWidth={1.8} />
              {explanation ? "Regenerate" : "Generate explanation"}
            </>
          )}
        </Button>
      }
    >
      {!explanation && state?.status !== "loading" && (
        <div className="flex flex-col items-start gap-2 border border-dashed border-border/70 px-4 py-6">
          <p className="text-xs text-muted-foreground">
            No explanation generated yet for {incident.id}. The deterministic evidence summary below
            is always available; generating adds a narrative hypothesis on top of it.
          </p>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => explain(incidentId)}>
            <Sparkles className="size-3.5" /> Generate explanation
          </Button>
        </div>
      )}

      {state?.status === "loading" && !explanation && (
        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Asking the model to reason over{" "}
          {incident.alertCount} alerts…
        </div>
      )}

      {explanation && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em]">
            <span className="border border-border/70 px-2 py-0.5 text-muted-foreground">
              {explanation.generator === "ai" ? "AI-generated hypothesis" : "Deterministic explanation"}
            </span>
            <span className="border border-border/70 px-2 py-0.5 text-muted-foreground">
              evidence: {incident.evidence.length} correlation rules
            </span>
            {explanation.degraded && explanation.generator === "deterministic" && (
              <span className="border border-[var(--sev-warning)]/50 px-2 py-0.5 sev-warning">
                model unreachable — fallback used
              </span>
            )}
          </div>

          <p className="max-w-4xl text-[13px] leading-relaxed text-foreground/90">
            {explanation.summary}
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Competing hypotheses
              </p>
              <ul className="mt-2 space-y-3">
                {explanation.hypotheses.map((h) => (
                  <li key={h.service} className="border border-border/60 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] text-foreground">
                        #{h.rank} {SERVICE_MAP[h.service]?.name ?? h.service}
                      </span>
                      <span className="tnum text-[11px] text-muted-foreground">score {h.score}</span>
                    </div>
                    {showEvidence && (
                      <ul className="mt-1.5 space-y-1">
                        {h.supporting.map((line, i) => (
                          <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
                            <span className="text-muted-foreground/60">·</span> {line}
                          </li>
                        ))}
                      </ul>
                    )}
                    {h.counter && (
                      <p className="mt-1.5 border-l-2 border-[var(--sev-warning)]/50 pl-2 text-[11px] leading-snug sev-warning">
                        {h.counter}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <button
                className="mt-2 text-[11px] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                onClick={() => setShowEvidence((v) => !v)}
              >
                {showEvidence ? "Hide supporting evidence" : "Show supporting evidence"}
              </button>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Suggested investigation steps
              </p>
              <ol className="mt-2 space-y-2">
                {explanation.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-foreground/90">
                    <span className="tnum mt-0.5 flex size-4 shrink-0 items-center justify-center border border-border text-[10px] text-muted-foreground">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            Hypotheses are ranked from dependency position, event ordering and severity in{" "}
            <Link to="/dashboard/evaluation" className="underline decoration-border underline-offset-4">
              the correlation engine
            </Link>
            . The model may only restate that evidence — it cannot merge incidents or add alerts.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

export function CorrelationEvidence({ incidentId }: { incidentId: string }) {
  const { incidentById } = useStore();
  const incident = incidentById(incidentId);
  if (!incident) return null;
  return (
    <SectionCard
      title="Correlation evidence"
      description="Rules that grouped these alerts together"
      actions={<Workflow className="size-4 text-muted-foreground" strokeWidth={1.6} />}
    >
      <ul className="space-y-2">
        {incident.evidence.map((line, i) => (
          <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-foreground/90">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--sev-info)]" />
            {line}
          </li>
        ))}
        {incident.evidence.length === 0 && (
          <li className="text-xs text-muted-foreground">No cross-service rules applied.</li>
        )}
      </ul>
    </SectionCard>
  );
}
