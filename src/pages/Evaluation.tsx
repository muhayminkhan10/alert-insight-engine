import { SectionCard } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { num, pct } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function EvaluationPage() {
  const { evaluation, heldOut, toggleHeldOut, analysis, seed } = useStore();

  const chartData = [
    {
      name: "grouping precision",
      baseline: +(evaluation.baseline.precision * 100).toFixed(1),
      engine: +(evaluation.proposed.precision * 100).toFixed(1),
    },
    {
      name: "grouping recall",
      baseline: +(evaluation.baseline.recall * 100).toFixed(1),
      engine: +(evaluation.proposed.recall * 100).toFixed(1),
    },
    {
      name: "F1",
      baseline: +(evaluation.baseline.f1 * 100).toFixed(1),
      engine: +(evaluation.proposed.f1 * 100).toFixed(1),
    },
    {
      name: "root-cause top-1",
      baseline: +(evaluation.baselineRootTop1 * 100).toFixed(1),
      engine: +(evaluation.proposedRootTop1 * 100).toFixed(1),
    },
    {
      name: "alert reduction %",
      baseline: 0,
      engine: +(evaluation.alertReductionRate * 100).toFixed(1),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-sm font-medium tracking-tight">Baseline vs correlation engine</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {evaluation.matching}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Ground-truth labels exist only here — the detector never sees them. Scope:{" "}
              <span className="text-foreground">{evaluation.scopeLabel}</span>.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button size="sm" variant={heldOut ? "default" : "outline"} className="h-8 text-xs" onClick={toggleHeldOut}>
              {heldOut ? "Held-out set active" : "Evaluate on held-out set"}
            </Button>
            <p className="tnum text-[11px] text-muted-foreground">
              {heldOut ? `seed ${seed + 977}` : `seed ${seed}`} · analysis {analysis.durationMs}ms
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Mini
            label="Raw → unique → incidents"
            value={`${num(evaluation.rawAlertCount)} → ${num(evaluation.uniqueAlertCount)} → ${num(evaluation.proposedIncidentCount)}`}
            hint={`baseline produces ${num(evaluation.baselineIncidentCount)}`}
          />
          <Mini
            label="Ground-truth incidents"
            value={num(evaluation.groundTruthCount)}
            hint={`${num(evaluation.proposed.truePositives)} matched · ${num(evaluation.proposed.falsePositives)} FP · ${num(evaluation.proposed.falseNegatives)} FN`}
            tone={evaluation.proposed.falsePositives + evaluation.proposed.falseNegatives === 0 ? "ok" : "default"}
          />
          <Mini
            label="Alert reduction rate"
            value={pct(evaluation.alertReductionRate)}
            hint="1 − incidents / unique alerts"
            tone="ok"
          />
          <Mini
            label="Analysis execution time"
            value={`${evaluation.proposedMs} ms`}
            hint={`baseline dedupe pass: ${evaluation.baselineMs} ms`}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Detector comparison"
          description="Both detectors scored against the same labelled alert groups"
        >
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="oklch(1 0 0 / 6%)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 4%)" }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" iconSize={8} />
                <Bar dataKey="baseline" name="baseline (1 alert = 1 incident)" fill="oklch(0.5 0.01 260)" barSize={16} />
                <Bar dataKey="engine" name="correlation engine" fill="oklch(0.85 0.002 260)" barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Counters" description="Where each detector disagrees with labels">
          <ul className="space-y-3 text-xs">
            <li className="flex items-baseline justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Baseline predicted groups</span>
              <span className="tnum">{num(evaluation.baselineIncidentCount)}</span>
            </li>
            <li className="flex items-baseline justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Engine predicted groups</span>
              <span className="tnum">{num(evaluation.proposedIncidentCount)}</span>
            </li>
            <li className="flex items-baseline justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Baseline false positives</span>
              <span className="tnum sev-warning">{num(evaluation.baseline.falsePositives)}</span>
            </li>
            <li className="flex items-baseline justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Engine false positives</span>
              <span className="tnum sev-warning">{num(evaluation.proposed.falsePositives)}</span>
            </li>
            <li className="flex items-baseline justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Baseline false negatives</span>
              <span className="tnum sev-critical">{num(evaluation.baseline.falseNegatives)}</span>
            </li>
            <li className="flex items-baseline justify-between border-b border-border/50 pb-2">
              <span className="text-muted-foreground">Engine false negatives</span>
              <span className="tnum sev-critical">{num(evaluation.proposed.falseNegatives)}</span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Groups merged by the engine</span>
              <span className="tnum">
                {num(evaluation.baselineIncidentCount - evaluation.proposedIncidentCount)}
              </span>
            </li>
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="Metric definitions and values" bodyClassName="p-0" description="Every value recomputed from the loaded dataset">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-4 py-2 font-normal">Metric</th>
                <th className="px-3 py-2 font-normal">Definition</th>
                <th className="px-3 py-2 text-right font-normal">Baseline</th>
                <th className="px-3 py-2 text-right font-normal">Engine</th>
                <th className="px-4 py-2 text-right font-normal">Change</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.rows.map((row) => {
                const better =
                  row.format === "number" && !row.higherIsBetter
                    ? row.proposed < row.baseline
                    : row.higherIsBetter
                      ? row.proposed > row.baseline
                      : row.proposed < row.baseline;
                const fmt = (v: number) =>
                  row.format === "percent" ? pct(v) : row.format === "ms" ? `${v} ms` : num(v);
                const delta = row.proposed - row.baseline;
                return (
                  <tr key={row.label} className="border-b border-border/40">
                    <td className="px-4 py-2.5 text-[13px] text-foreground">{row.label}</td>
                    <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{row.definition}</td>
                    <td className="tnum px-3 py-2.5 text-right text-[13px] text-muted-foreground">
                      {fmt(row.baseline)}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-[13px] text-foreground">
                      {fmt(row.proposed)}
                    </td>
                    <td
                      className={`tnum px-4 py-2.5 text-right text-[12px] ${
                        delta === 0 ? "text-muted-foreground" : better ? "sev-ok" : "sev-warning"
                      }`}
                    >
                      {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${row.format === "percent" ? `${(delta * 100).toFixed(1)} pp` : row.format === "ms" ? `${delta.toFixed(1)} ms` : num(delta)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Per-incident match detail"
        description="Overlap between each labelled incident and the engine's best prediction"
        bodyClassName="p-0"
      >
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-4 py-2 font-normal">Labelled incident</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Predicted</th>
                <th className="px-3 py-2 text-right font-normal">Overlap</th>
                <th className="px-3 py-2 text-right font-normal">Alerts</th>
                <th className="px-4 py-2 text-right font-normal">Root cause</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.matchDetail.map((row) => (
                <tr key={row.groundTruthId} className="border-b border-border/40">
                  <td className="max-w-[280px] px-4 py-2.5">
                    <p className="truncate text-[13px]">{row.title}</p>
                    <p className="tnum text-[10px] text-muted-foreground">{row.groundTruthId}</p>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{row.scenarioName}</td>
                  <td className="max-w-[240px] px-3 py-2.5 text-[12px]">
                    {row.predictedId ? (
                      <span className="truncate">
                        <span className="tnum text-muted-foreground">{row.predictedId}</span>{" "}
                        <span className="text-foreground/80">{row.predictedTitle}</span>
                      </span>
                    ) : (
                      <span className="sev-critical">no matching prediction</span>
                    )}
                  </td>
                  <td
                    className={`tnum px-3 py-2.5 text-right text-[12px] ${
                      row.overlap >= 0.5 ? "sev-ok" : row.overlap > 0 ? "sev-warning" : "text-muted-foreground"
                    }`}
                  >
                    {row.overlap.toFixed(2)}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-[12px] text-muted-foreground">{row.size}</td>
                  <td className="px-4 py-2.5 text-right text-[12px]">
                    {row.rootCorrect === null ? (
                      <span className="text-muted-foreground">n/a</span>
                    ) : row.rootCorrect ? (
                      <span className="sev-ok">correct</span>
                    ) : (
                      <span className="sev-critical">missed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}

function Mini({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok";
}) {
  return (
    <div className="border border-border/70 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className={`tnum mt-1.5 text-lg font-medium leading-none ${tone === "ok" ? "sev-ok" : ""}`}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
