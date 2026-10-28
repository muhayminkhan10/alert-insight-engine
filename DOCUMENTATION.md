# AI Alert Correlation & Incident Detection Platform

Documentation for the hackathon build — what it does, how every number is produced, and how to demo it.

> **Simulated data:** every alert, service and incident in this app is synthetic and generated in the browser. No real monitoring infrastructure is connected, and nothing is persisted outside the current session. All views are labelled accordingly.

---

## 1. What the product does

Hundreds of noisy alerts come out of a distributed system. The app turns them into a handful of actionable incidents:

```
Synthetic alert generation
        ↓
Normalization + fingerprint deduplication (duplicate suppression)
        ↓
Deterministic correlation (dependency + time + type + severity rules)
        ↓
Incident creation, with an inspectable reason for every decision
        ↓
Root-cause ranking over the dependency graph
        ↓
AI / deterministic explanation (hypotheses, never new evidence)
        ↓
Evaluation: proposed engine vs. naive baseline, scored against ground truth
```

The demo moment: **which alerts deserve a human right now, and which are safe to ignore.** Every alert is triaged into `action`, `review`, or `ignore` with a written reason.

---

## 2. Five-minute demo script

1. **Overview** — KPIs are computed from the live dataset: total alerts, unique alerts, active incidents, duplicates suppressed, noise-reduction rate, root-cause accuracy. Point out the alert-volume chart and the recent-incidents table.
2. **Live Alerts** — the centerpiece. Filter by attention level: ~9 alerts in `action`, ~50 in `review`, ~430 in `ignore`. Open one alert to see its incident, duplicate status, and the exact rules that grouped it.
3. **Incidents → open a cascade** (e.g. *"Connection pool exhaustion cascading through payments and checkout"*). Show: probable root cause, ranked candidates with evidence, chronological timeline, suppressed duplicates, dependency graph, and status controls (acknowledge / resolve / reopen).
4. **Service Map** — red node = root-cause candidate, amber = caught in an incident, green = healthy. Arrows show who calls whom; failures travel against them.
5. **AI Root Cause Analysis** — generate an explanation. With no API key it uses the deterministic generator (labelled as such); with a key it uses the model, always framed as hypotheses over existing evidence.
6. **Evaluation** — baseline (one incident per unique alert) vs. the correlation engine, scored with explicit overlap matching. Click "held-out dataset" to re-run everything on a fresh unseen seed.
7. Press **Run analysis** and **New dataset** to show that every number is recomputed, never hardcoded.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + TypeScript, Tailwind v4, shadcn/ui, Lucide icons |
| Routing | React Router v7 (`react-router`), lazy-loaded routes |
| Charts | Recharts |
| Backend | Convex (auth + one server action) |
| Auth | Convex Auth — email OTP + anonymous sign-in |
| AI | Gemini API (optional) via Convex action, platform integration fallback, deterministic fallback |
| Styling | Minimalism theme: near-monochrome, colour reserved for severity/status (`src/index.css`) |
| Package manager | Bun |

The detection engine itself is **pure TypeScript with no dependencies** — it runs entirely client-side in milliseconds (~45 ms for a full pass).

---

## 4. Project structure

```
src/
├── main.tsx                     # routes, providers, error boundaries
├── index.css                    # theme tokens (severity colours, minimalism palette)
├── lib/
│   ├── store.tsx                # shared app state (dataset, analysis, statuses, evaluation)
│   ├── format.ts                # number/time formatting helpers
│   └── engine/
│       ├── types.ts             # Alert, Incident, config, evaluation types
│       ├── services.ts          # 70 services, 168 dependency edges, graph helpers
│       ├── generate.ts          # deterministic synthetic dataset + ground truth
│       ├── correlate.ts         # dedup + correlation rules + attention triage
│       ├── rootcause.ts         # root-cause candidate ranking
│       ├── explain.ts           # deterministic explanation generator
│       └── evaluate.ts          # baseline vs. engine, overlap matching
├── components/
│   ├── AppShell.tsx             # sidebar, top bar (status + Run analysis), outlet
│   ├── DependencyGraph.tsx      # pure-SVG tiered dependency map
│   ├── IncidentExplanation.tsx  # AI/deterministic explanation panel + evidence list
│   └── bits.tsx                 # badges, section cards, severity dots
├── pages/                       # one file per route (see §8)
└── convex/
    ├── ai.ts                    # explainIncident action ("use node", server-side keys)
    ├── auth*, users.ts, schema.ts
```

---

## 5. Synthetic alert engine (`engine/generate.ts`)

**Deterministic:** a seeded PRNG (`mulberry32`) means a given seed always reproduces the same dataset. Default seed: `20261028`; "New dataset" draws a new random seed.

**Alert record — 16 fields:**
`id, ts, ingestDelayMs, service, environment, severity, type, family, metric, value, threshold, unit, description, source, fingerprint, scenarioId` (the last is ground-truth-only and is never read by the correlation engine).

**Alert types (12)** in 6 families: `connection_pool`, `query_latency`, `request_latency`, `error_rate`, `timeout`, `cpu_saturation`, `memory_saturation`, `disk_pressure`, `availability`, `certificate_expiry`, `queue_backlog`, `replication_lag` → resource / latency / error / availability / security / data.

**Scale (default seed):** 70 services, 168 dependency edges, 490 raw alerts → 244 unique after dedup, 246 duplicates suppressed, 109 incidents from 109 ground-truth groups. Across other seeds: 456–515 raw, 230–252 unique, 102–113 incidents.

**Five scripted scenarios** (identical on every seed, so the demo is stable):

| # | Scenario | Root cause | Shape |
|---|---|---|---|
| A | Database connection exhaustion cascade | `primary-db` | multi-service cascade through payments/checkout/gateway |
| B | Upstream search latency propagation | `search-indexer` | latency spreading downstream to the edge |
| C | Media worker resource saturation | `image-processor` | CPU/memory saturation across the media group |
| D | Isolated certificate expiry | `secrets-broker` | single critical alert that must stay its own incident |
| E | Staging replica replication lag | `replica-db` | read-path degradation in staging |

**Background noise:** seeded bursts across all three environments on a 7-minute grid (kept outside the correlation window of each other so unrelated alerts stay unrelated), each burst with repeat firings and duplicate deliveries.

**Injected realism:** duplicates (identical fingerprint, seconds apart), delayed ingestion (`ingestDelayMs`), and a full shuffle so timestamps arrive out of order.

**Ground truth — 7 fields:** `id, title, scenarioId, scenarioName, alertIds, rootCause, environment`. Every alert belongs to exactly one ground-truth group: 5 scripted groups + one group per noise burst. Used **only** by the Evaluation page.

> `environment` (production / staging / development) remains a field on each alert for realism; the top-bar environment selector was removed to keep the UI uncluttered.

---

## 6. Correlation engine (`engine/correlate.ts`)

### Pipeline

1. **Dedup** — alerts sharing a fingerprint (`env|service|type|metric`) within 2 minutes collapse into one canonical alert. Duplicates are recorded, attached to their canonical alert's incident, and never counted as separate signals.
2. **Score** — each unique alert is scored against every open incident. A join requires **all gates** to pass and score ≥ threshold:

| Gate (hard filter) | Rule |
|---|---|
| Environment isolation | staging alerts never join production incidents |
| Time window | alert must fall within 15 min of the incident's last event |
| Dependency link | service must be within **2 hops** of an existing member |
| Temporal proximity | nearest related event within **3 minutes** |

| Scoring rule | Points |
|---|---|
| Same service already firing | +6 |
| Dependency (1 hop / 2 hops) | +3 / +2 |
| Temporal proximity within gate | +2 |
| Compatible alert family | +1 |
| Severity consistent with a cascade | +1 |

   Join threshold: **5**. All gates, points, and rejected candidates are stored per alert as inspectable evidence.
3. **Cluster** — alerts that never reach the threshold start their own incident.
4. **Triage** — every alert gets an attention level with a written reason:
   - `action` (~9 alerts) — critical severity, or on the probable root-cause service of a high-severity cascade
   - `review` (~49) — part of a known incident or a standalone high-severity singleton
   - `ignore` (~432) — low-severity background; safe to defer while the root cause is handled
5. **Rank root causes** (see §7) and build timeline, evidence, and titles.

### Config knobs (`engine/types.ts → DEFAULT_CONFIG`)

```ts
timeWindowMs: 15 min   // how far an alert can be from an incident to join
dedupWindowMs: 2 min   // identical fingerprints inside this collapse
temporalGateMs: 3 min  // cross-service joins need an event this close
maxGraphHops: 2        // dependency distance considered "related"
joinThreshold: 5       // score needed to join
```

### Incident record

`id, title, severity, status (open/acknowledged/resolved), startTs, lastTs, services, alertIds, duplicateIds, evidence[], rootCauses[] (ranked), probableRootCause, timeline[], environments, alertCount, suppressedCount`.

---

## 7. Root-cause ranking (`engine/rootcause.ts`)

Each member service receives a score from transparent signals, each shown with points:

- **Dependency position** — upstream of the failures beats downstream; fewer hops to the blast is better.
- **Event ordering** — the service that fired first gets the ordering bonus.
- **Downstream fan-out** — more affected dependents = higher rank.
- **Severity & timing consistency** — early + severe + followed by milder symptoms elsewhere reads as cause, not symptom.

Output: ranked candidates with per-signal evidence, plus the top pick as `probableRootCause`. Ground truth is attached to candidates **for the evaluation view only**.

---

## 8. AI explanation layer

- **Client** asks for an explanation per incident (`src/lib/store.tsx → explain`), with a 9-second timeout.
- **Server** (`src/convex/ai.ts`, Convex action, `"use node"`) tries, in order:
  1. **Gemini** — if `GEMINI_API_KEY` is set on the Convex deployment
  2. **Platform AI integration** — if `VLY_INTEGRATION_KEY` is present
  3. `ok: false` — the client falls back to the deterministic generator
- Credentials stay server-side; nothing secret reaches the browser.
- The model must answer **only from supplied evidence** and return strict JSON (`summary`, `hypotheses[]`, `steps[]`). Hypotheses naming services outside the incident are discarded, and the model **cannot merge incidents or add alerts** — it only narrates what the engine already decided.
- The UI always labels the output: "AI-generated hypothesis" vs. "Deterministic explanation", and shows a "model unreachable — fallback used" chip when degraded.

**Enabling Gemini:** add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, default `gemini-2.0-flash`) to the Convex deployment environment variables. The app is fully functional without it.

---

## 9. Evaluation methodology (`engine/evaluate.ts`)

**Baseline detector:** every unique (deduplicated) alert is its own incident — the "pager for everything" approach.
**Proposed detector:** the correlation engine.

**Matching rule (explicit, not alert-count arithmetic):** each detector's alert groups are compared to ground-truth groups with **Jaccard overlap** `|A ∩ B| / |A ∪ B|`; pairs are matched greedily highest-overlap first and count as a match at **≥ 0.5**. Unmatched predictions = false positives, unmatched ground truths = false negatives. Both groups include the suppressed duplicates they own, so dedup is attributed rather than penalised. Root-cause top-1 accuracy is scored only on each detector's own matched groups (baseline names its fragment's service; the engine names its ranked candidate).

**12 metrics, all recomputed per dataset:** raw alerts, unique alerts, predicted incidents, ground-truth incidents, alert-reduction rate, grouping precision, grouping recall, F1, false positives, false negatives, root-cause top-1 accuracy, measured execution time.

**Current results (default seed; stable across seeds):**

| | Baseline | Engine |
|---|---|---|
| Grouping precision | 43 % | **100 %** |
| Grouping recall | 96 % | **100 %** |
| Predicted incidents | 244 | **109** (GT: 109) |
| Alert-reduction rate | 0 % | **55 %** |
| Root-cause top-1 | 100 %* | **100 %** |

\* On noise bursts the baseline trivially names the alert's own service; it never matches the scripted multi-service cascades, which are exactly where root-cause ranking matters. The Evaluation page also offers a **held-out dataset** (seed + 977) so judges can confirm nothing is tuned to one seed.

---

## 10. Pages & navigation

| Route | Purpose |
|---|---|
| `/` | Landing page → CTAs into `/auth` |
| `/auth` | Sign-in (email OTP or **Continue as guest**), returns to the requested page |
| `/dashboard` | **Overview** — KPI cards, alert volume, severity distribution, top services, recent incidents, activity feed, dataset controls |
| `/dashboard/alerts` | **Live Alerts** — search, severity/service/type/time/attention filters, sortable columns, pagination, expandable rows with incident + duplicate + rule evidence |
| `/dashboard/incidents` | **Incidents** — register with search, severity/status filters, group stats |
| `/dashboard/incidents/:id` | **Incident investigation** — summary, root cause + ranked candidates with evidence, timeline, related alerts, dependency graph, suppressed duplicates, AI explanation, status controls |
| `/dashboard/services` | **Service Map** — tiered dependency graph, health dots, focus toggle, node details with incidents and recent alerts |
| `/dashboard/rca` | **AI Root Cause Analysis** — incident queue (sortable by severity/alert count) plus the selected incident's ranked candidates, the five scoring signals, and the 4-step method summary |
| `/dashboard/evaluation` | **Evaluation** — baseline vs. engine table, charts, per-incident match detail, held-out toggle, matching-method explanation |

Top bar (all pages): simulation status indicator (**"stale — re-run analysis"** when the dataset/config changed since the last run) and the prominent **Run analysis** button. Sidebar footer: **New dataset**, **Reset demo**, seed + alert count, and the *Simulated data* tag.

---

## 11. State & controls

All state is a single React context (`src/lib/store.tsx`) — dataset, correlation config, analysis, statuses, explanations, evaluation, activity feed.

- **New dataset** — new random seed, regenerates alerts + ground truth, clears statuses/explanations, logs to the activity feed.
- **Reset demo** — same, back to seed `20261028`, so the demo script is reproducible.
- **Run analysis** — re-runs the correlation pass and clears the "stale" flag (the pass also runs automatically whenever the dataset or config changes).
- **Incident statuses** (open → acknowledged → resolved → reopen) update app state immediately and feed back into KPIs, the service map, and filters.

**Persistence caveat:** statuses and generated explanations live in memory for the session only — regenerating the dataset clears them. Nothing is stored in Convex, and the UI does not claim otherwise.

---

## 12. Environment variables

| Variable | Where | Required? | Purpose |
|---|---|---|---|
| `VITE_CONVEX_URL`, `CONVEX_DEPLOYMENT` | project env | yes | Convex connection (pre-configured) |
| `GEMINI_API_KEY` | **Convex deployment env** | no | Gemini explanations; falls back if absent |
| `GEMINI_MODEL` | Convex deployment env | no | default `gemini-2.0-flash` |
| `VLY_INTEGRATION_KEY` | project env | no | platform AI fallback |
| `VLY_AI_MODEL` | Convex env | no | default `gpt-4o-mini` |

No secrets are hardcoded in source files; the browser never sees any key.

---

## 13. Development & verification

```bash
bun install                      # if needed
bun convex dev --once            # codegen + push Convex functions (non-interactive)
bunx tsc -b --noEmit             # typecheck
bun run dev                      # local dev server (platform runs it in the cloud env)
```

Last verified: Convex functions compile, `tsc -b --noEmit` passes, and an engine smoke run confirmed the numbers in §5 and §9.

---

## 14. Known limitations

- **No incident history/persistence** — incidents derive from the current 6-hour window; status changes are session-scoped (§11).
- **Evaluation is in-browser** — metrics recompute per dataset; there is no stored results table.
- **Simulated data only** — labelled in the UI; no real Prometheus/Datadog connection.
- **Service map is hand-laid SVG** — chosen over a graph library to keep the bundle small; layout is tier-based rather than force-directed.
- **AI layer is optional by design** — without a key the deterministic generator keeps the full demo path intact.

---

## 15. Quick FAQ

1. **Alert types?** 12 types across 6 families, from 5 synthetic sources.
2. **Historical incidents?** Not persisted — derived per dataset, session-scoped statuses.
3. **Ground truth?** 100 % coverage: 5 scripted scenarios + one group per noise burst; evaluation-only.
4. **IP/customer data?** None exists — service/metric fields only, fully synthetic, no PII.
5. **Intelligence layer?** Dedup → gated/scored correlation → dependency-graph root-cause ranking → attention triage → model narration with deterministic fallback.
6. **Columns?** 16 per alert + a 7-field ground-truth table.
7. **Filters?** Search, severity, service, alert type, time range, attention level, sortable columns, pagination (plus severity/status on Incidents).
8. **Dependency map's role?** Direction + timing identify who is upstream: the engine rewards firing first with downstream fan-out; the map lets a judge verify it visually.
9. **Environment modes?** Just synthetic tags on alerts; the top-bar selector was removed to keep the UI clean.
10. **Service map clarity?** 4 tier columns instead of 12, arrows routed around nodes, status dots + legend, hover tooltips, corrected focus toggle.
11. **Why counts changed per dataset?** The seed now drives burst pacing and duplicate rates, so every "New dataset" genuinely differs (456–515 alerts, 102–113 incidents).
