# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### UI/UX Fixes
- KPI value headings in the dark hero section now have explicit `text-white` to prevent Card component defaults from dimming the text.

## Important Notes

- **`dist/` is committed** — rebuild (`npm run build`) before committing frontend changes.
- **`@` path alias** maps to `src/` — use `@/app/...` for imports.
- Backend has a hardcoded fallback DB password in `server/db.cjs` — always prefer env vars.
- The `CallVolumeSimulator` class in `server/server.cjs` generates deterministic synthetic call volume data with channel profiles, seasonality, and intraday shapes — used for demo/testing when no live Genesys data is available.
- **Staffing Models:** Voice uses Erlang C; chat uses modified Erlang C with concurrency factor; email uses a daily backlog-clearing model. In blended pools, voice establishes the base and remaining idle capacity absorbs chat (concurrency-adjusted) first, then email.
