import { SERVICES, SERVICE_MAP } from "@/lib/engine/services";
import type { ServiceDef } from "@/lib/engine/types";

export type NodeState = "root" | "affected" | "healthy" | "selected" | "muted" | "default";

const STATE_STYLE: Record<
  NodeState,
  { stroke: string; fill: string; text: string; dot: string; dotStroke?: string }
> = {
  root: {
    stroke: "var(--sev-critical)",
    fill: "oklch(0.655 0.205 25.5 / 12%)",
    text: "var(--foreground)",
    dot: "var(--sev-critical)",
  },
  affected: {
    stroke: "var(--sev-warning)",
    fill: "oklch(0.775 0.145 65 / 10%)",
    text: "var(--foreground)",
    dot: "var(--sev-warning)",
  },
  healthy: {
    stroke: "oklch(1 0 0 / 16%)",
    fill: "oklch(1 0 0 / 3%)",
    text: "var(--muted-foreground)",
    dot: "var(--sev-ok)",
  },
  selected: {
    stroke: "oklch(1 0 0 / 70%)",
    fill: "oklch(1 0 0 / 8%)",
    text: "var(--foreground)",
    dot: "oklch(1 0 0 / 70%)",
  },
  muted: {
    stroke: "oklch(1 0 0 / 8%)",
    fill: "transparent",
    text: "oklch(1 0 0 / 32%)",
    dot: "oklch(1 0 0 / 22%)",
  },
  default: {
    stroke: "oklch(1 0 0 / 16%)",
    fill: "oklch(1 0 0 / 3%)",
    text: "var(--muted-foreground)",
    dot: "oklch(1 0 0 / 28%)",
  },
};

/** Columns are dependency tiers: callers on the left, infrastructure right. */
const TIER_LABEL: Record<number, string> = {
  0: "Tier 0 · edge (callers)",
  1: "Tier 1 · gateway",
  2: "Tier 2 · services",
  3: "Tier 3 · data & infra",
};

const COL_W = 200;
const NODE_W = COL_W - 30;
const ROW_H = 26;
const ROW_GAP = 5;
const PAD_X = 14;
const HEADER_H = 30;

interface Layout {
  columns: Array<{ key: number; label: string; nodes: ServiceDef[] }>;
  position: Map<string, { x: number; y: number }>;
  height: number;
  width: number;
}

function buildLayout(services: ServiceDef[]): Layout {
  const groups = new Map<number, ServiceDef[]>();
  for (const service of services) {
    const list = groups.get(service.tier) ?? [];
    list.push(service);
    groups.set(service.tier, list);
  }

  const columns = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, nodes]) => ({
      key: tier,
      label: TIER_LABEL[tier] ?? `Tier ${tier}`,
      // Related services (same domain) stay adjacent inside the column.
      nodes: [...nodes].sort(
        (x, y) => x.domain.localeCompare(y.domain) || x.name.localeCompare(y.name),
      ),
    }));

  const position = new Map<string, { x: number; y: number }>();
  let maxRows = 0;
  columns.forEach((column, colIndex) => {
    column.nodes.forEach((node, rowIndex) => {
      position.set(node.id, {
        x: PAD_X + colIndex * COL_W,
        y: HEADER_H + rowIndex * (ROW_H + ROW_GAP),
      });
    });
    maxRows = Math.max(maxRows, column.nodes.length);
  });

  return {
    columns,
    position,
    width: PAD_X * 2 + columns.length * COL_W,
    height: HEADER_H + maxRows * (ROW_H + ROW_GAP) + 8,
  };
}

/**
 * Layered dependency graph in pure SVG — no graph library.
 *
 * Columns are dependency tiers, so callers sit on the left and the services
 * they call sit to the right. Each arrow points from a service to the service
 * it calls; failures therefore travel against the arrows. Nodes carry a
 * status dot (red root-cause candidate, amber affected, green healthy).
 */
export function DependencyGraph({
  services = SERVICES,
  states = {},
  selected,
  onSelect,
  edgeMode = "all",
}: {
  services?: ServiceDef[];
  states?: Record<string, NodeState>;
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** "all" draws every edge; "highlight" only draws edges touching a coloured node. */
  edgeMode?: "all" | "highlight";
}) {
  const layout = buildLayout(services);
  const visible = new Set(services.map((s) => s.id));

  const edges = services.flatMap((service) =>
    service.deps
      .filter((dep) => visible.has(dep))
      .map((dep) => ({ from: service.id, to: dep })),
  );

  const emphasised = (id: string) => {
    const state = states[id];
    return state === "root" || state === "affected" || state === "selected";
  };

  const drawn = edges.filter((edge) => {
    if (edgeMode === "all") return true;
    return emphasised(edge.from) || emphasised(edge.to);
  });

  /** Edge leaves the source on the side facing the target and enters the
   *  target on the side facing the source, so arrows never cross a node. */
  const route = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const y1 = from.y + ROW_H / 2;
    const y2 = to.y + ROW_H / 2;
    if (to.x > from.x) {
      const x1 = from.x + NODE_W;
      const x2 = to.x;
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    }
    if (to.x < from.x) {
      const x1 = from.x;
      const x2 = to.x + NODE_W;
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    }
    // Same column: bulge around the right edge of both nodes.
    const x1 = from.x + NODE_W;
    const x2 = to.x + NODE_W;
    return `M ${x1} ${y1} C ${x1 + 28} ${y1}, ${x2 + 28} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className="scrollbar-thin max-h-[640px] w-full overflow-auto border border-border/60 bg-background/40">
      <svg width={layout.width} height={layout.height} className="block">
        <defs>
          <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="oklch(1 0 0 / 28%)" />
          </marker>
          <marker id="arrow-hot" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="oklch(0.775 0.145 65 / 80%)" />
          </marker>
        </defs>

        {layout.columns.map((column, colIndex) => (
          <g key={column.key}>
            <line
              x1={PAD_X + colIndex * COL_W - 10}
              y1={18}
              x2={PAD_X + colIndex * COL_W - 10}
              y2={layout.height - 6}
              stroke="oklch(1 0 0 / 6%)"
              strokeDasharray="2 4"
            />
            <text
              x={PAD_X + colIndex * COL_W}
              y={14}
              fontSize="9"
              letterSpacing="0.1em"
              fill="oklch(0.64 0.012 260)"
              style={{ textTransform: "uppercase" }}
            >
              {column.label}
            </text>
          </g>
        ))}

        {drawn.map((edge) => {
          const from = layout.position.get(edge.from);
          const to = layout.position.get(edge.to);
          if (!from || !to) return null;
          const hot = emphasised(edge.from) && emphasised(edge.to);
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={route(from, to)}
              fill="none"
              stroke={hot ? "oklch(0.775 0.145 65 / 60%)" : "oklch(1 0 0 / 14%)"}
              strokeWidth={hot ? 1.4 : 0.8}
              markerEnd={hot ? "url(#arrow-hot)" : "url(#arrow)"}
            />
          );
        })}

        {services.map((service) => {
          const pos = layout.position.get(service.id);
          if (!pos) return null;
          const baseState = states[service.id] ?? "default";
          const style = STATE_STYLE[baseState];
          const isSelected = selected === service.id;
          const depends = service.deps.length;
          return (
            <g
              key={service.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              onClick={() => onSelect?.(service.id)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              <title>{`${service.name} — ${service.domain} · ${depends} call${depends === 1 ? "" : "s"}: ${service.deps.map((d) => SERVICE_MAP[d]?.name ?? d).join(", ") || "none (leaf dependency)"}`}</title>
              <rect
                width={NODE_W}
                height={ROW_H}
                rx="2"
                fill={style.fill}
                stroke={isSelected ? STATE_STYLE.selected.stroke : style.stroke}
                strokeWidth={baseState === "root" || isSelected ? 1.5 : 0.8}
              />
              <circle cx={NODE_W - 9} cy={ROW_H / 2} r="3" fill={style.dot} />
              <text
                x="8"
                y={ROW_H / 2 + 3.5}
                fontSize="10.5"
                fill={style.text}
                style={{ fontFamily: "inherit" }}
              >
                {service.name.length > 22 ? `${service.name.slice(0, 21)}…` : service.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function serviceExists(id: string) {
  return Boolean(SERVICE_MAP[id]);
}
