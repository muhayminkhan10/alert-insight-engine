import { type ReactNode } from "react";
import { fmtClock, fmtRelative } from "@/lib/format";
import type { Attention, IncidentStatus, Severity } from "@/lib/engine/types";

export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "sev-critical",
  high: "sev-warning",
  medium: "sev-info",
  low: "sev-muted",
};

export function severityDot(severity: Severity) {
  return severity === "critical"
    ? "var(--sev-critical)"
    : severity === "high"
      ? "var(--sev-warning)"
      : severity === "medium"
        ? "var(--sev-info)"
        : "var(--sev-muted)";
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] uppercase tracking-[0.08em]">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: severityDot(severity) }}
      />
      <span className={SEVERITY_CLASS[severity]}>{severity}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const tone =
    status === "resolved"
      ? "text-[var(--sev-ok)]"
      : status === "acknowledged"
        ? "text-[var(--sev-info)]"
        : "text-[var(--sev-warning)]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 border border-border/80 px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] ${tone}`}
    >
      {status}
    </span>
  );
}

export function AttentionBadge({ attention }: { attention: Attention }) {
  const map: Record<Attention, { label: string; className: string }> = {
    action: { label: "act now", className: "attention-action" },
    review: { label: "review", className: "attention-review" },
    ignore: { label: "safe to ignore", className: "attention-ignore" },
  };
  const entry = map[attention];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${entry.className}`}
    >
      {entry.label}
    </span>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`border border-border/70 bg-card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-3 sm:px-5">
          <div>
            {title && (
              <h2 className="text-sm font-medium tracking-tight text-foreground">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName || "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  sub,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "critical" | "warning" | "info" | "ok";
  sub?: ReactNode;
}) {
  const toneClass =
    tone === "critical"
      ? "sev-critical"
      : tone === "warning"
        ? "sev-warning"
        : tone === "info"
          ? "sev-info"
          : tone === "ok"
            ? "sev-ok"
            : "text-foreground";
  return (
    <div className="group border border-border/70 bg-card px-4 py-3.5 transition-colors hover:border-border">
      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className={`tnum mt-2 text-2xl font-medium leading-none tracking-tight ${toneClass}`}>
        {value}
      </p>
      {sub && <div className="mt-1.5 text-[11px] text-muted-foreground">{sub}</div>}
      {hint && <p className="mt-2 text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border border-dashed border-border/70 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function EventTime({ ts, reference }: { ts: number; reference?: number }) {
  return (
    <span className="tnum whitespace-nowrap text-xs text-muted-foreground">
      {reference !== undefined ? fmtRelative(ts, reference) : fmtClock(ts)}
    </span>
  );
}

export function SimulatedTag() {
  return (
    <span className="inline-flex items-center gap-1.5 border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      <span className="size-1.5 rounded-full bg-[var(--sev-warning)]" />
      simulated data
    </span>
  );
}
