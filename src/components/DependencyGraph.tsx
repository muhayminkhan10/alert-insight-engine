import { SERVICES, SERVICE_MAP } from "@/lib/engine/services";
import type { ServiceDef } from "@/lib/engine/types";

export type NodeState = "root" | "affected" | "selected" | "muted" | "default";

const STATE_STYLE: Record<NodeState, { stroke: string; fill: string; text: string }> = {
  root: { stroke: "var(--sev-critical)", fill: "oklch(0.655 0.205 25.5 / 12%)", text: "var(--foreground)" },
  affected: { stroke: "var(--sev-warning)", fill: "oklch(0.775 0.145 65 / 10%)", text: "var(--foreground)" },
  selected: { stroke: "oklch(1 0 0 / 70%)", fill: "oklch(1 0 0 / 8%)", text: "var(--foreground)" },
  muted: { stroke: "oklch(1 0 0 / 10%)", fill: "transparent", text: "var(--muted-foreground)" },
  default: { stroke: "oklch(1 0 0 / 16%)", fill: "oklch(1 0 0 / 3%)", text: "var(--muted-foreground)" },
};

const COL_W = 170;
const ROW_H = 30;
const ROW_GAP = 6;

interface Layout {
  columns: Array<{ key: string; label: string; nodes: ServiceDef[] }>;
  position: Map<string, { x: number; y: number }>;
  height: number;
  width: number;
}

function buildLayout(services: ServiceDef[]): Layout {
  const groups = new Map<string, ServiceDef[]>();
  for (const service of services) {
    const key = `${service.tier}-${service.domain}`;
    const list = groups.get(key) ?? [];
    list.push(service);
    groups.set(key, list);
  }
  const columns = [...groups.entries()]
    .sort((a, b) => {
      const [tierA, domainA] = a[0].split("-");
      const [tierB, domainB] = b[0].split("-");
      return Number(tierA) - Number(tierB) || domainA.localeCompare(domainB) || 0;
    })
    .map(([key, nodes]) => ({
      key,
      label: key.split("-")[1],
      nodes: nodes.sort((x, y) => x.name.localeCompare(y.name)),
    }));

  const position = new Map<string, { x: number; y: number }>();
  let maxRows = 0;
  columns.forEach((column, colIndex) => {
    column.nodes.forEach((node, rowIndex) => {
      position.set(node.id, {
        x: 12 + colIndex * COL_W,
        y: 26 + rowIndex * (ROW_H + ROW_GAP),
      });
    });
    maxRows = Math.max(maxRows, column.nodes.length);
  });

  return {
    columns,
    position,
    width: 24 + columns.length * COL_W,
    height: 26 + maxRows * (ROW_H + ROW_GAP) + 12,
  };
}

/**
 * Layered dependency graph. Columns are (tier, domain) groups, so the
 * upstream-to-downstream direction reads left to right. Pure SVG — no graph
 * library, so it stays fast and dependency-free.
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

  return (
    <div className="scrollbar-thin w-full overflow-auto border border-border/60 bg-background/40">
      <svg width={layout.width} height={layout.height} className="block">
        <defs>
          <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="oklch(1 0 0 / 24%)" />
          </marker>
          <marker id="arrow-hot" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="oklch(0.775 0.145 65 / 70%)" />
          </marker>
        </defs>

        {drawn.map((edge) => {
          const from = layout.position.get(edge.from);
          const to = layout.position.get(edge.to);
          if (!from || !to) return null;
          const hot = emphasised(edge.from) && emphasised(edge.to);
          const x1 = from.x + 8;
          const y1 = from.y + ROW_H / 2;
          const x2 = to.x + COL_W - 34;
          const y2 = to.y + ROW_H / 2;
          const midX = (x1 + x2) / 2;
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={hot ? "oklch(0.775 0.145 65 / 60%)" : "oklch(1 0 0 / 12%)"}
              strokeWidth={hot ? 1.4 : 0.8}
              markerEnd={hot ? "url(#arrow-hot)" : "url(#arrow)"}
            />
          );
        })}

        {layout.columns.map((column) => (
          <text
            key={column.key}
            x={12 + layout.columns.indexOf(column) * COL_W}
            y={14}
            fontSize="9"
            letterSpacing="0.1em"
            fill="oklch(0.64 0.012 260)"
            style={{ textTransform: "uppercase" }}
          >
            {column.label}
          </text>
        ))}

        {services.map((service) => {
          const pos = layout.position.get(service.id);
          if (!pos) return null;
          const state = states[service.id] ?? "default";
          const style = STATE_STYLE[state];
          const isSelected = selected === service.id;
          return (
            <g
              key={service.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              onClick={() => onSelect?.(service.id)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              <rect
                width={COL_W - 26}
                height={ROW_H}
                rx="2"
                fill={style.fill}
                stroke={isSelected ? STATE_STYLE.selected.stroke : style.stroke}
                strokeWidth={state === "root" || isSelected ? 1.5 : 0.8}
              />
              <text
                x="8"
                y={ROW_H / 2 + 3.5}
                fontSize="10.5"
                fill={style.text}
                style={{ fontFamily: "inherit" }}
              >
                {service.name.length > 20 ? `${service.name.slice(0, 19)}…` : service.name}
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
