import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SimulatedTag } from "@/components/bits";
import { useStore, type EnvScope } from "@/lib/store";
import { num } from "@/lib/format";
import {
  Activity,
  AlertTriangle,
  Beaker,
  GitMerge,
  LayoutGrid,
  Network,
  Radar,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

export const NAV_ITEMS = [
  { to: "/dashboard", end: true, label: "Overview", icon: LayoutGrid },
  { to: "/dashboard/alerts", end: false, label: "Live Alerts", icon: Radar },
  { to: "/dashboard/incidents", end: false, label: "Incidents", icon: GitMerge },
  { to: "/dashboard/services", end: false, label: "Service Map", icon: Network },
  { to: "/dashboard/rca", end: false, label: "AI Root Cause Analysis", icon: AlertTriangle },
  { to: "/dashboard/evaluation", end: false, label: "Evaluation", icon: Beaker },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/alerts": "Live Alerts",
  "/dashboard/incidents": "Incidents",
  "/dashboard/services": "Service Map",
  "/dashboard/rca": "AI Root Cause Analysis",
  "/dashboard/evaluation": "Evaluation",
};

export function AppShell() {
  const {
    envScope,
    setEnvScope,
    runAnalysisNow,
    analysis,
    dataset,
    stale,
    seed,
    generateFresh,
    resetDemo,
    scopedAlerts,
  } = useStore();
  const location = useLocation();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setRunning(false), 450);
    return () => clearTimeout(id);
  }, [running]);

  const handleRun = () => {
    setRunning(true);
    runAnalysisNow();
  };

  const pageTitle =
    TITLES[location.pathname] ??
    (location.pathname.startsWith("/dashboard/incidents/") ? "Incident Investigation" : "Overview");

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/70 bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-border/70 px-5">
          <span className="flex size-6 items-center justify-center border border-border text-[11px] font-semibold">
            IC
          </span>
          <div className="leading-tight">
            <p className="text-[13px] font-medium tracking-tight text-foreground">Incident Control</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              correlation engine
            </p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              <item.icon className="size-4 shrink-0" strokeWidth={1.6} />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-border/70 px-4 py-4">
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Dataset
            </p>
            <p className="tnum text-xs text-muted-foreground">
              seed #{seed} · {num(dataset.alerts.length)} alerts
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 justify-center text-[11px]"
              onClick={generateFresh}
            >
              New dataset
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 justify-center text-[11px]"
              onClick={resetDemo}
            >
              Reset demo
            </Button>
          </div>
          <SimulatedTag />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2.5 lg:hidden">
              <span className="flex size-6 items-center justify-center border border-border text-[11px] font-semibold">
                IC
              </span>
              <span className="text-[13px] font-medium">{pageTitle}</span>
            </div>

            <div className="hidden min-w-0 lg:block">
              <h1 className="truncate text-[15px] font-medium tracking-tight">{pageTitle}</h1>
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <Select
                value={envScope}
                onValueChange={(value) => setEnvScope(value as EnvScope)}
              >
                <SelectTrigger className="h-8 w-[150px] gap-1.5 text-xs sm:w-[170px]">
                  <SelectValue placeholder="Environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All environments</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="development">development</SelectItem>
                </SelectContent>
              </Select>

              <div
                className="hidden items-center gap-2 border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground md:flex"
                title={`Last run ${new Date(analysis.runAt).toLocaleTimeString()} · ${analysis.durationMs}ms`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    stale ? "bg-[var(--sev-warning)]" : "bg-[var(--sev-ok)]"
                  }`}
                />
                <span className="tnum">
                  {stale
                    ? "stale — re-run analysis"
                    : `${num(analysis.incidents.length)} incidents · ${analysis.durationMs}ms`}
                </span>
              </div>

              <Button
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={handleRun}
                disabled={running}
              >
                <Activity className={`size-3.5 ${running ? "animate-pulse" : ""}`} strokeWidth={1.8} />
                {running ? "Running…" : "Run analysis"}
              </Button>
            </div>
          </div>

          {/* Mobile nav */}
          <nav className="flex gap-1 overflow-x-auto border-t border-border/60 px-3 py-2 lg:hidden">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `whitespace-nowrap border px-2.5 py-1 text-[11px] transition-colors ${
                    isActive
                      ? "border-border bg-sidebar-accent text-foreground"
                      : "border-transparent text-muted-foreground"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground lg:hidden">
            <span className="tnum">
              {num(scopedAlerts.length)} alerts in scope · seed #{seed}
            </span>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={generateFresh}>
              New dataset
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={resetDemo}>
              Reset
            </Button>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
