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

Two processes must run in development: `npm run dev` and `npm run start`.

There is no `npm test` script defined. Test files exist (e.g., `InteractionArrival.test.tsx`, `LongTermForecasting.test.ts`) but the test runner is not wired up in package.json.

## Architecture

**Stack:** React 18 + TypeScript (frontend) / Node.js Express + PostgreSQL (backend). Vite for bundling. Tailwind CSS 4 + Radix UI / Shadcn components. Recharts for data visualization.

Vite proxies all `/api/*` requests to `localhost:5000` in dev. In production, Express serves `dist/` as a static SPA and handles `/api/*` directly.

### Frontend (`src/`)

```
src/main.tsx                      # Entry point — RouterProvider + context providers
src/app/routes.tsx                # 19+ lazy-loaded routes (React Router v7)
src/app/pages/                    # Full-page feature modules
src/app/pages/forecasting-logic.ts         # Shared forecast algorithms (YoY, Moving Avg, Linear Regression, Holt-Winters, ARIMA, Decomposition)
src/app/pages/intraday-distribution-logic.ts  # Erlang C, FTE smoothing — shared by IntradayForecast + ScheduleEditor
src/app/pages/LongTermForecasting_Demand.help.ts  # Print-friendly HTML help documentation generator
src/app/components/ui/            # Radix-based UI primitives (Shadcn pattern)
src/app/lib/api.ts                # apiUrl() helper — always use this for API calls
src/app/lib/lobContext.tsx        # LOBProvider + useLOB() — active LOB and channel, global
src/app/lib/whatIfContext.tsx     # WhatIfProvider + useWhatIf() — What-If scenario list, demand planner global
src/app/lib/WFMPageDataContext.tsx  # WFMPageDataProvider — passes page data + triggers to WFM AI assistant
src/app/lib/usePagePreferences.ts # Generic hook for persisting per-page UI state to DB
src/app/lib/timezone.ts           # DST utilities, TIMEZONE_OPTIONS list
```

Page components own their data fetching via `useEffect`. No global state manager — React hooks + context only. `useMemo` is used heavily for expensive forecasting calculations.

### Context Provider Tree (in `src/main.tsx`)

Providers wrap the entire app in this order:
- `ThemeProvider` — dark/light mode
- `LOBProvider` — active LOB + active channel (persisted to localStorage)
- `WhatIfProvider` — What-If scenario list for Demand Planner (per active LOB)
- `WFMPageDataProvider` — passes current page data to the floating WFM AI assistant

### Backend (`server/`)

```
server/server.cjs              # Express entry — all routes, SPA fallback, ensureAppTables()
server/db.cjs                  # pg connection pool; calls ensureAppTables() on startup
server/auth.cjs                # getCurrentUser() — mock auth, reads X-Organization-Id header
server/genesys.cjs             # Genesys Cloud (PureCloud) API integration
server/scheduling/generator.cjs  # Auto-scheduler: multi-pass greedy + local search
```

Backend is CommonJS (`.cjs`). Tables auto-created on startup via `ensureAppTables()` in `server/server.cjs`.

### Authentication

All `/api/*` routes except `/api/auth/*` are protected by `requireAuth` middleware in `server/server.cjs`. Auth uses a custom JWT signed with `SESSION_SECRET`, stored as an `HttpOnly` cookie (`wfm_token`, 12h TTL). The login system uses `ADMIN_PASSWORD` (default: `admin123`). `server/auth.cjs` provides `getCurrentUser()` which is currently mock-auth that reads `X-Organization-Id` header (multi-tenancy scaffolding, not enforced).

### AI Assistant

`WFMAssistant.tsx` is a floating chat panel rendered in `PageLayout`. It streams responses from `/api/ai/chat` using Server-Sent Events. AI provider (Anthropic/OpenAI/Gemini/Groq), model, and API key are stored in the `ai_settings` DB table and configured via `/configuration/ai-settings`. The `WFMPageDataContext` allows any page to publish structured data to the assistant via `setPageData()`, giving the LLM context about what the user is looking at.

### Scheduling Module

`server/scheduling/generator.cjs` implements a multi-pass greedy + local-search auto-scheduler:
- Each agent gets ONE start time per week, 5 working days, 2 consecutive rest days
- Shift boundaries snap to 30-minute granularity within LOB hours of operation
- Optimizes to minimize squared shortage across all intervals
- Reads from: `agent_roster`, `shift_templates`, `scheduler_rules`, `lob_settings`, the committed What-If demand snapshot
- Writes draft schedules to `schedule_assignments`

### Key Domain Modules

| Page | Route | Purpose |
|------|-------|---------|
| `LongTermForecasting_Demand.tsx` | `/wfm/long-term-forecasting-demand` | Demand planning: volume forecast + FTE sizing with multi-channel BPO staffing math |
| `CapacityPlanning.tsx` | `/wfm/capacity` | Erlang-C staffing scenarios |
| `ShrinkagePlanning.tsx` | `/wfm/shrinkage` | Shrinkage itemization, hours/day, net FTE gross-up |
| `IntradayForecast.tsx` | `/wfm/intraday` | Interval-level FTE requirements using Erlang C |
| `ScheduleEditor.tsx` | `/scheduling/schedule` | Weekly schedule grid with drag-and-drop; DST warnings |
| `AgentRoster.tsx` | `/scheduling/agents` | Agent list with shift/channel assignments |
| `ShiftTemplates.tsx` | `/scheduling/shifts` | Reusable shift definitions |
| `SchedulerRules.tsx` | `/scheduling/scheduler-rules` | Constraints fed to the auto-scheduler |
| `AISettings.tsx` | `/configuration/ai-settings` | AI provider/model/key configuration |
| `LOBManagement.tsx` | `/configuration/lob-management` | LOB CRUD + metadata (scenario counts, last activity) |
| `LOBSettings.tsx` | `/configuration/lob-settings` | Per-LOB config: hours of operation, demand/supply timezones |

## Environment Variables

```
PORT=5000
SESSION_SECRET=...                # JWT signing key — sessions reset on restart if omitted
ADMIN_PASSWORD=...                # Login password (default: admin123)

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

Frontend API base is controlled by `src/app/lib/api.ts` — uses relative `/api` paths by default.

## Persistence Architecture

### Principle
All user-editable state must persist to the database (not browser/localStorage only) so data survives page refreshes and syncs across devices (local dev ↔ Render deployment).

### DB Tables for State Persistence

| Table | Purpose | Key |
|-------|---------|-----|
| `demand_planner_scenarios` | What-If demand snapshots | `PRIMARY KEY (scenario_id, organization_id)` |
| `demand_planner_active_state` | Active working state for Demand Planner | `PRIMARY KEY (organization_id)` |
| `shrinkage_plans` | One shrinkage plan per org+LOB | `UNIQUE(organization_id, lob_id)` |
| `user_preferences` | Generic per-page UI state | `UNIQUE(organization_id, lob_id, page_key)` LOB-scoped; partial index for global |
| `ai_settings` | AI provider/model/encrypted key | per organization |

### `usePagePreferences` Hook (`src/app/lib/usePagePreferences.ts`)
```typescript
const [prefs, setPrefs] = usePagePreferences("page_key", defaults, lobScoped?);
// setPrefs({ field: value }) — partial update, auto-saves to DB after 1.5s debounce
```

**Page keys:**
- `"capacity_planning"` — `active_scenario_id`, `selected_channel` (LOB-scoped)
- `"arrival_analysis"` — channel, view, layout, weekStart, selYear/Month/Week/Day, intervalSize (LOB-scoped)
- `"interaction_arrival"` — channel, dates, tab, intervalSize, telephonySystem (LOB-scoped)
- `"performance_analytics"` — startDate, endDate, startTime, endTime, rollupLevel (**global**, lobScoped=false)
- `"intraday_forecast"` — smooth toggle, smoothWindow (LOB-scoped)

### NULL lob_id in user_preferences
PostgreSQL treats NULLs as distinct in UNIQUE constraints. The global (PerformanceAnalytics) upsert uses an explicit UPDATE-then-INSERT pattern rather than `ON CONFLICT`.

### Demand Planner State Hydration Priority
In `LongTermForecasting_Demand.tsx`:
1. `localStorage` first — dev environment source of truth
2. DB active state second — used on other devices where localStorage is empty
3. Scenario snapshot third — fallback when neither exists

On every state change, writes to both `localStorage` (instant) and DB (debounced 2s).

### ShrinkagePlanning
Mirrors computed totals to localStorage under `wfm_shrinkage_totals_lob{id}` for `LongTermForecasting_Demand` to read.

## Staffing Model Rules

**Voice:** Erlang C. **Chat:** Modified Erlang C with concurrency factor. **Email:** Daily backlog-clearing model (async workload ÷ available agent-seconds; occupancy/utilisation IS the input, not an output). **Blended pools:** Voice establishes the base; remaining idle capacity absorbs chat (concurrency-adjusted) first, then email.

**Erlang C occupancy is an OUTPUT, not an input.** The only driver of `rawAgents` is the SLA target. Never add an occupancy floor to the Erlang staffing loop — that would over-staff every interval.

**Daily FTE formula:**
```
Daily FTE = Σ(FTE_interval × grainHours) / hoursPerDay
```
`grainHours` = 0.25 / 0.5 / 1.0 for 15 / 30 / 60-min grain. `hoursPerDay` from `shrinkage_plans.hours_per_day` (default 7.5).

**Interval FTE smoothing:** `smoothFTEValues(fteValues, halfWindow)` in `intraday-distribution-logic.ts` applies a centered rolling average then renormalizes so `Σ(smoothed) === Σ(raw)`. The daily total is always preserved.

## Schema Migration Rules

Any `DO $$ BEGIN ALTER TABLE ... ADD CONSTRAINT ... END; $$` block in `ensureAppTables()` must catch **both** `duplicate_object` AND `duplicate_table`:
```sql
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN undefined_table THEN NULL;
```
PostgreSQL error `42P07` (`duplicate_table`) is thrown when adding a constraint whose backing index already exists — this is different from `42710` (`duplicate_object`).

## Table Component — Sticky Headers

CSS `position: sticky` on `<thead>` requires the nearest scroll ancestor to be the same element as the one with `overflow-auto` and `maxHeight`. Always make the `Table` component's container the scroll boundary:
```tsx
<Table containerClassName="overflow-auto" containerStyle={{ maxHeight: 500 }}>
```
Never wrap `<Table>` in a separate `overflow-auto` div and expect sticky to work.

## Important Notes

- **`dist/` is committed** — rebuild (`npm run build`) before committing frontend changes.
- **`@` path alias** maps to `src/` — use `@/app/...` for imports.
- Backend has a hardcoded fallback DB password in `server/db.cjs` — always prefer env vars.
- The `CallVolumeSimulator` class in `server/server.cjs` generates deterministic synthetic call volume data — used for demo/testing when no live Genesys data is available.
- `forecasting-logic.ts` and `intraday-distribution-logic.ts` live in `src/app/pages/` but are shared algorithm modules, not page components — import them from any page that needs forecasting or Erlang math.
