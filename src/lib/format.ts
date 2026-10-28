const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${fmtClock(ts)}`;
}

export function fmtDayTime(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${fmtClock(ts)}`;
}

export function fmtRelative(ts: number, now = Date.now()): string {
  const diff = Math.round((now - ts) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? " ago" : "";
  const prefix = diff < 0 ? "in " : "";
  if (abs < 60) return `${prefix}${abs}s${suffix}`;
  if (abs < 3600) return `${prefix}${Math.round(abs / 60)}m${suffix}`;
  if (abs < 86400) return `${prefix}${Math.round(abs / 3600)}h${suffix}`;
  return `${prefix}${Math.round(abs / 86400)}d${suffix}`;
}

export function fmtDelta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return `${ms.toFixed(1)} ms`;
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function num(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

export function fmtValue(value: number, unit: string): string {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded}${unit ? ` ${unit}` : ""}`;
}
