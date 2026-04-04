# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Style

Do not make any changes until you have 95% confidence in what you need to build. Ask follow-up questions until you reach that confidence.

## Commands

```bash
npm run dev        # Start Vite dev server (frontend on :5173, proxies /api → :5000)
npm run build      # Produce production bundle in dist/
npm run start      # Run Express backend from server/server.cjs on port 5000
```

There is no `npm test` script defined. Test files exist (e.g., `InteractionArrival.test.tsx`, `LongTermForecasting.test.ts`) but the test runner is not wired up in package.json.

## Architecture

**Stack:** React 18 + TypeScript (frontend) / Node.js Express + PostgreSQL (backend). Vite for bundling. Tailwind CSS 4 + Radix UI / Shadcn components. Recharts for data visualization.

**Two processes must run in development:**
- `npm run dev` — Vite dev server (frontend)
- `npm run start` — Express backend (API + DB access)

Vite proxies all `/api/*` requests to `localhost:5000` in dev. In production, the Express server serves `dist/` as a static SPA and handles `/api/*` directly.

### Frontend (`src/`)

```
src/main.tsx                      # Entry point — RouterProvider
src/app/routes.tsx                # 14 flat routes (React Router v7)
src/app/pages/                    # Full-page feature modules
src/app/pages/forecasting-logic.ts # Shared forecast algorithms (YoY, Moving Avg, Linear Regression, Holt-Winters)
src/app/components/ui/            # Radix-based UI primitives (Shadcn pattern)
src/app/lib/api.ts                # apiUrl() helper — always use this for API calls
```

Page components own their data fetching (fetch on mount via `useEffect`). No global state manager — React hooks only. `useMemo` is used heavily for expensive forecasting calculations.

### Backend (`server/`)

```
server/server.cjs    # Express entry — registers all routes, serves SPA fallback
server/db.cjs        # pg connection pool; calls ensureAppTables() on startup to auto-create tables
server/genesys.cjs   # Genesys Cloud (PureCloud) API integration
```

Backend is CommonJS (`.cjs`). Tables are created automatically on first run via `ensureAppTables()` in `db.cjs`.

### Key Domain Modules

| Page | Purpose |
|------|---------|
| `Forecasting.tsx` | Holt-Winters triple exponential smoothing engine |
| `LongTermForecasting.tsx` | Multi-year blended staffing forecast |
| `LongTermForecasting_Demand.tsx` | Demand planning with growth scenarios |
| `CapacityPlanning.tsx` | Erlang-C staffing calculations |
| `ArrivalAnalysis.tsx` | Intraday call volume heatmaps |
| `InteractionArrival.tsx` | Telephony interval data ingestion |

## Environment Variables

The app requires a `.env` file (git-ignored). Backend reads these at startup:

```
PORT=5000

# PostgreSQL (local or Supabase)
DATABASE_URL=postgresql://user:pass@host/db
# OR individual vars:
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=...
PGDATABASE=exordium_db
PGSSL=false

# Genesys Cloud (optional — for live data sync)
GENESYS_CLIENT_ID=...
GENESYS_CLIENT_SECRET=...
GENESYS_REGION=mypurecloud.com
```

Frontend API base is controlled by `src/app/lib/api.ts` — uses relative `/api` paths by default (works with Vite proxy in dev and Express static serving in prod).

## Recent Changes & Fixes

### Multi-Channel BPO Staffing Math (Commit: 0dce6ff)

**Problem:** `LongTermForecasting_Demand.tsx` had two staffing calculation bugs affecting multi-channel blended BPO scenarios.

**Bug 1 — Seasonality index double-counting volumes:**
- The `seasonalityTrend` memo was iterating through included channels and summing their volumes on top of `row.volume`, which already contained the sum of all included channels.
- Result: With Voice+Email+Chat selected, non-voice channels were counted twice (e.g., Email and Chat volumes appeared in both the row.volume sum AND as explicit additions).
- **Fix:** Directly use `row.volume` which is already the correct total.

**Bug 2 — Dedicated chat/email pool FTE under-counting:**
- `calculatePooledFTE` routed single-channel pools through `calculateBlendedTriChannelRequirement` with other volumes = 0.
- With no voice base, chat and email collapsed to pure traffic-intensity models (workload ÷ interval hours), skipping SLA queuing for chat and the backlog formula for email.
- Could under-count dedicated chat FTE by ~40–50% at typical occupancy.
- **Fix:** For single-channel pools, delegate directly to the per-channel staffing model (`getChannelStaffingMetrics`) which uses Erlang C (voice/chat) or backlog logic (email).

**Growth Rate Enhancement:**
- Growth rate parameter was only visible when `forecastMethod === "yoy"`.
- **Improvement:** Now always visible in Demand Assumptions. Applied as a post-multiplier (× multiplier) for all non-YoY methods so planners can overlay growth/decline on any statistical forecast.
- Badge dynamically shows green for positive growth, red for negative; input accepts −100% to +500%.

### Cross-Device State Sync (Commit: 1c1fa17)

**Problem:** `LongTermForecasting_Demand.tsx` stored the active working state (`poolingMode`, `selectedChannels`, scenario selection, etc.) only in `localStorage`. Since `localStorage` is per-domain and per-browser, the deployed Render app showed different (wrong) chart data than the local dev server — specifically, `poolingMode: "dedicated"` from the DB scenario snapshot instead of the user's `poolingMode: "blended"` from localStorage.

**Root cause:** The DB scenario snapshots preserved whatever `poolingMode` was active when the scenario was last explicitly saved. If the user later changed `poolingMode` without re-saving the scenario, only `localStorage` got updated. Other computers (or the Render deployment) had no way to access that state.

**Fix — DB-backed active state with correct hydration priority:**
- **New table:** `demand_planner_active_state` (auto-created by `ensureAppTables()`) stores the current working state per organization.
- **New endpoints:** `GET/PUT /api/demand-planner-active-state` in `server/server.cjs`.
- **Hydration priority** (in `LongTermForecasting_Demand.tsx`):
  1. `localStorage` first — dev environment is the source of truth
  2. DB active state second — used on other devices where localStorage is empty
  3. Scenario snapshot third — fallback when neither exists
- **Persistence:** On every state change, writes to both `localStorage` (instant) and DB (debounced 2s, fire-and-forget).

**Important — when deploying new state-sync changes:** After pushing, restart the local Express server (`npm run start`) so the new table is created, then visit the page on `localhost:5173` to seed the DB with the correct state from localStorage. The Render deployment will then read that state from the DB.

### UI/UX Fixes
- KPI value headings in the dark hero section now have explicit `text-white` to prevent Card component defaults from dimming the text.

### LOB Hierarchy — Server Startup Crash (2026-04-04)

**Problem:** After implementing the LOB (Line of Business) hierarchy feature across a session that hit the CLI limit, the server would crash immediately on startup with:
```
Startup schema initialization failed: relation "forecasts_year_lob_channel_key" already exists
process.exit(1)
```

**Root cause:** `ensureAppTables()` in `server/server.cjs` adds unique constraints using `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END; $$` PL/pgSQL blocks. In PostgreSQL, `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` creates a backing index whose name is treated as a *relation*. On a second startup, attempting to add an already-existing constraint throws error code `42P07` (`duplicate_table`), not `42710` (`duplicate_object`). The exception handler only caught `duplicate_object`, so the error propagated and killed the process.

**Fix:** Added `WHEN duplicate_table THEN NULL` to every `ADD CONSTRAINT` DO block in `ensureAppTables()`:
```sql
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN undefined_table THEN NULL;
```

**Rule going forward:** Any `DO $$ BEGIN ALTER TABLE ... ADD CONSTRAINT ... END; $$` block in `ensureAppTables()` must catch **both** `duplicate_object` AND `duplicate_table` to be safe across repeated restarts.

## Persistence Architecture

### Principle
All user-editable state must persist to the database (not browser/localStorage only) so data survives page refreshes and syncs across devices (local dev ↔ Render deployment).

### DB Tables for Persistence

| Table | Purpose | Key |
|-------|---------|-----|
| `shrinkage_plans` | One shrinkage plan per org+LOB — all items, hours/day, days/week, net FTE | `UNIQUE(organization_id, lob_id)` |
| `user_preferences` | Generic per-page UI state (view mode, date ranges, selected channel, etc.) | `UNIQUE(organization_id, lob_id, page_key)` for LOB-scoped; partial index for global (`lob_id IS NULL`) |

### API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET/PUT` | `/api/shrinkage-plan?lob_id=X` | Fetch / upsert shrinkage plan for a LOB |
| `GET/PUT` | `/api/user-preferences?page_key=X&lob_id=X` | Fetch / upsert per-page preferences (omit `lob_id` for global) |
| `GET` | `/api/lobs/metadata` | LOBs + capacity/demand scenario counts + last activity |

### `usePagePreferences` Hook (`src/app/lib/usePagePreferences.ts`)
Generic hook used by all pages to load and debounced-save preferences:
```typescript
const [prefs, setPrefs] = usePagePreferences("page_key", defaults, lobScoped?);
// setPrefs({ field: value }) — partial update, auto-saves to DB after 1.5s debounce
```

**Page keys:**
- `"capacity_planning"` — persists `active_scenario_id`, `selected_channel` (LOB-scoped)
- `"arrival_analysis"` — persists channel, view, layout, weekStart, selYear/Month/Week/Day, intervalSize (LOB-scoped)
- `"interaction_arrival"` — persists channel, dates, tab, intervalSize, telephonySystem (LOB-scoped)
- `"performance_analytics"` — persists startDate, endDate, startTime, endTime, rollupLevel (**global**, lobScoped=false)

### NULL lob_id in user_preferences
PostgreSQL treats NULLs as distinct in UNIQUE constraints. The global (PerformanceAnalytics) upsert uses an explicit UPDATE-then-INSERT pattern rather than `ON CONFLICT` to avoid duplicate rows.

### ShrinkagePlanning
Uses a dedicated `shrinkage-plan` endpoint (not `user_preferences`) because its data is structured. Loads on mount and on LOB switch, auto-saves with 1.5s debounce. Also mirrors computed totals to localStorage under key `wfm_shrinkage_totals_lob{id}` for LongTermForecasting_Demand to read.

### LOB Management Page
Route: `/configuration/lob-management` — accessible from the Configuration page (Lines of Business card with chevron). Shows rich table: LOB name, created date, capacity scenario count, demand scenario count, last activity. Uses `/api/lobs/metadata`.

## Important Notes

- **`dist/` is committed** — rebuild (`npm run build`) before committing frontend changes.
- **`@` path alias** maps to `src/` — use `@/app/...` for imports.
- Backend has a hardcoded fallback DB password in `server/db.cjs` — always prefer env vars.
- The `CallVolumeSimulator` class in `server/server.cjs` generates deterministic synthetic call volume data with channel profiles, seasonality, and intraday shapes — used for demo/testing when no live Genesys data is available.
- **Staffing Models:** Voice uses Erlang C; chat uses modified Erlang C with concurrency factor; email uses a daily backlog-clearing model. In blended pools, voice establishes the base and remaining idle capacity absorbs chat (concurrency-adjusted) first, then email.
