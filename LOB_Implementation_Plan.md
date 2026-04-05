# LOB (Line of Business) Implementation Plan

**Status:** Awaiting approval before any code changes are made.  
**Author:** Claude Code  
**Date:** 2026-04-04  

---

## Overview

This document plans the refactor of Exordium WFM to introduce a top-level **Line of Business (LOB)** hierarchy. Every LOB is a fully isolated workforce planning context — its forecasting, shrinkage planning, capacity planning, and arrival data are completely independent of all other LOBs.

### Core Principles

- **Isolation:** No data bleeds between LOBs. Channels (Voice, Email, Chat) are a *sub-dimension within* each LOB.
- **Flexibility:** Users can create, rename, and delete LOBs without limit.
- **Backwards Compatibility:** Existing data (currently `organization_id = 1`) will be migrated into a default LOB during Phase 1.
- **Progressive Enhancement:** LOB context propagates through a lightweight global state; page components need only subscribe, not be restructured.

---

## Files Affected

### Backend (`server/`)

| File | Change Type | Reason |
|------|-------------|--------|
| `server/db.cjs` | **Modify** | Add `lobs` table to `ensureAppTables()`, add `lob_id` columns to all data tables, create default LOB migration block |
| `server/server.cjs` | **Modify** | Add 5 LOB CRUD endpoints; update all 14 channel-aware endpoints to accept and filter by `lob_id` |
| `server/auth.cjs` | **Minor modify** | Extend `getCurrentUser()` return to include `active_lob_id` (optional) |

### Frontend (`src/`)

| File | Change Type | Reason |
|------|-------------|--------|
| `src/app/lib/api.ts` | **Modify** | Add `lobId` injection helper so all fetch calls can forward active LOB |
| `src/app/lib/lobContext.tsx` | **New** | React Context + `useLOB()` hook — global LOB state |
| `src/main.tsx` | **Modify** | Wrap `<RouterProvider>` in `<LOBProvider>` |
| `src/app/components/PageLayout.tsx` | **Modify** | Embed `<LOBSelector>` in the header bar |
| `src/app/components/LOBSelector.tsx` | **New** | Dropdown component — create, rename, switch LOBs |
| `src/app/routes.tsx` | **No change** | Routes stay flat; LOB is a context filter, not a route segment |
| `src/app/pages/CapacityPlanning.tsx` | **Modify** | Read `activeLobId` from context; pass to all API fetches |
| `src/app/pages/InteractionArrival.tsx` | **Modify** | Same |
| `src/app/pages/ArrivalAnalysis.tsx` | **Modify** | Same |
| `src/app/pages/LongTermForecasting_Demand.tsx` | **Modify** | Same + update `demand_planner_active_state` to be LOB-scoped |
| `src/app/pages/ShrinkagePlanning.tsx` | **Modify** | Same |
| `src/app/pages/IntradayForecast.tsx` | **Modify** | Same (after audit) |
| `src/app/pages/PerformanceAnalytics.tsx` | **Modify** | Same (after audit) |
| `src/app/pages/EmployeeRoster.tsx` | **Modify** | Filter agents by LOB |

---

## Phase 1 — Database Schema & Migrations

### 1.1 New Table: `lobs`

```sql
CREATE TABLE IF NOT EXISTS lobs (
  id             SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL DEFAULT 1,
  lob_name       TEXT    NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, lob_name)
);
```

This table is the source of truth for all LOBs. There is no hard limit on rows per `organization_id`.

**Default seed (run once, idempotent):**

```sql
INSERT INTO lobs (organization_id, lob_name)
VALUES (1, 'Default LOB')
ON CONFLICT DO NOTHING;
```

### 1.2 Schema Modifications — Existing Tables

Each data table gets a new `lob_id` column referencing `lobs.id`. During migration, all existing rows are assigned to the default LOB.

#### `forecasts`

```sql
ALTER TABLE forecasts
  ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;

UPDATE forecasts SET lob_id = (
  SELECT id FROM lobs WHERE organization_id = forecasts.organization_id AND lob_name = 'Default LOB'
) WHERE lob_id IS NULL;

ALTER TABLE forecasts ALTER COLUMN lob_id SET NOT NULL;

-- Replace old unique constraint
ALTER TABLE forecasts
  DROP CONSTRAINT IF EXISTS forecasts_year_label_organization_id_channel_key;
ALTER TABLE forecasts
  ADD CONSTRAINT forecasts_year_label_lob_id_channel_key
  UNIQUE (year_label, lob_id, channel);
```

#### `capacity_scenarios`

```sql
ALTER TABLE capacity_scenarios
  ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;

UPDATE capacity_scenarios SET lob_id = (
  SELECT id FROM lobs WHERE organization_id = capacity_scenarios.organization_id AND lob_name = 'Default LOB'
) WHERE lob_id IS NULL;

ALTER TABLE capacity_scenarios ALTER COLUMN lob_id SET NOT NULL;
```

#### `interaction_arrival`

```sql
ALTER TABLE interaction_arrival
  ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;

UPDATE interaction_arrival SET lob_id = (
  SELECT id FROM lobs WHERE organization_id = interaction_arrival.organization_id AND lob_name = 'Default LOB'
) WHERE lob_id IS NULL;

ALTER TABLE interaction_arrival ALTER COLUMN lob_id SET NOT NULL;

-- Replace old unique constraint
ALTER TABLE interaction_arrival
  DROP CONSTRAINT IF EXISTS interaction_arrival_interval_date_interval_index_organization_id_channel_key;
ALTER TABLE interaction_arrival
  ADD CONSTRAINT interaction_arrival_date_idx_lob_channel_key
  UNIQUE (interval_date, interval_index, lob_id, channel);
```

#### `long_term_actuals`

```sql
ALTER TABLE long_term_actuals
  ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;

UPDATE long_term_actuals SET lob_id = (
  SELECT id FROM lobs WHERE organization_id = long_term_actuals.organization_id AND lob_name = 'Default LOB'
) WHERE lob_id IS NULL;

ALTER TABLE long_term_actuals ALTER COLUMN lob_id SET NOT NULL;
```

#### `demand_planner_scenarios`

```sql
ALTER TABLE demand_planner_scenarios
  ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;

UPDATE demand_planner_scenarios SET lob_id = (
  SELECT id FROM lobs WHERE organization_id = demand_planner_scenarios.organization_id AND lob_name = 'Default LOB'
) WHERE lob_id IS NULL;
-- NOT set to NOT NULL yet — existing scenarios may need to remain org-scoped until reassigned
```

#### `demand_planner_active_state`

The current PK is `organization_id` (one active state per org). With LOBs, the active state must be per-LOB.

```sql
ALTER TABLE demand_planner_active_state
  ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;

-- Migrate existing state to Default LOB
UPDATE demand_planner_active_state SET lob_id = (
  SELECT id FROM lobs WHERE organization_id = demand_planner_active_state.organization_id AND lob_name = 'Default LOB'
) WHERE lob_id IS NULL;

-- Rebuild PK
ALTER TABLE demand_planner_active_state
  DROP CONSTRAINT demand_planner_active_state_pkey;
ALTER TABLE demand_planner_active_state
  ADD PRIMARY KEY (organization_id, lob_id);
```

### 1.3 Interval Data Column Specification

The `interaction_arrival` table already has most required fields. The plan adds explicit columns to fully match the specified schema:

| Column | Type | Notes |
|--------|------|-------|
| `interval_start` | `TIMESTAMPTZ` | Rename/alias from `interval_date` + `interval_index`; or add computed column |
| `channel_type` | `TEXT` (enum-like) | Already exists as `channel` — rename for clarity |
| `direction` | `TEXT` | **New column.** `'Inbound'` or `'Outbound'` |
| `volume_received` | `INTEGER` | Already exists as `volume` — rename for clarity |
| `aht_seconds` | `INTEGER` | Already exists as `aht` — rename for clarity |
| `target_sl_percent` | `FLOAT` | **New column.** Per-interval SL target (nullable) |
| `target_tt_seconds` | `INTEGER` | **New column.** Target talk/handle time (nullable) |
| `concurrency_factor` | `FLOAT` | **New column.** For chat concurrent session multiplier |
| `lob_id` | `INTEGER` | FK to `lobs.id` (added above) |
| `organization_id` | `INTEGER` | Existing |

> **Note:** We will rename columns (`channel` → `channel_type`, `volume` → `volume_received`, `aht` → `aht_seconds`) in a non-breaking way by keeping the old column names as aliases in queries during a transition period, then fully renaming once all pages are updated.

### 1.4 Migration Execution Strategy

All schema changes are added to `ensureAppTables()` in `server/db.cjs` using `IF NOT EXISTS` and `IF EXISTS` guards so they are **idempotent** — safe to run on every server startup. No separate migration runner is needed.

Execution order within `ensureAppTables()`:
1. Create `lobs` table
2. Seed default LOB
3. `ALTER` each data table to add `lob_id`
4. `UPDATE` to assign existing rows to default LOB
5. `ALTER COLUMN lob_id SET NOT NULL`
6. Drop and recreate affected unique constraints

---

## Phase 2 — Global State Management

### 2.1 Decision: React Context (not Zustand)

**Rationale:** The app currently has zero external state management libraries and uses only React hooks. Adding Zustand for a single global value would be over-engineering. A lightweight Context + custom hook is idiomatic, zero-dependency, and consistent with the existing codebase patterns.

If future requirements grow (e.g., global notifications, multi-org management), Zustand can be adopted incrementally.

### 2.2 `LOBProvider` — New File: `src/app/lib/lobContext.tsx`

```typescript
// src/app/lib/lobContext.tsx
import { createContext, useContext, useEffect, useState } from "react";
import { apiUrl } from "@/app/lib/api";

export interface LOB {
  id: number;
  lob_name: string;
  organization_id: number;
}

interface LOBContextValue {
  lobs: LOB[];                              // All LOBs for the org
  activeLob: LOB | null;                   // Currently selected LOB
  setActiveLob: (lob: LOB) => void;        // Switch LOB
  createLob: (name: string) => Promise<LOB>;
  renameLob: (id: number, name: string) => Promise<void>;
  deleteLob: (id: number) => Promise<void>;
  isLoading: boolean;
}

const LOBContext = createContext<LOBContextValue | null>(null);

export function LOBProvider({ children }: { children: React.ReactNode }) {
  const [lobs, setLobs] = useState<LOB[]>([]);
  const [activeLob, setActiveLobState] = useState<LOB | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: fetch all LOBs, restore last-active from localStorage
  useEffect(() => {
    fetch(apiUrl("/api/lobs"))
      .then(r => r.json())
      .then((data: LOB[]) => {
        setLobs(data);
        const savedId = localStorage.getItem("activeLobId");
        const restored = savedId
          ? data.find(l => l.id === Number(savedId))
          : null;
        setActiveLobState(restored ?? data[0] ?? null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const setActiveLob = (lob: LOB) => {
    setActiveLobState(lob);
    localStorage.setItem("activeLobId", String(lob.id));
  };

  const createLob = async (name: string): Promise<LOB> => {
    const res = await fetch(apiUrl("/api/lobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lob_name: name }),
    });
    const newLob: LOB = await res.json();
    setLobs(prev => [...prev, newLob]);
    return newLob;
  };

  const renameLob = async (id: number, name: string): Promise<void> => {
    await fetch(apiUrl(`/api/lobs/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lob_name: name }),
    });
    setLobs(prev => prev.map(l => l.id === id ? { ...l, lob_name: name } : l));
    if (activeLob?.id === id) setActiveLobState(prev => prev ? { ...prev, lob_name: name } : prev);
  };

  const deleteLob = async (id: number): Promise<void> => {
    await fetch(apiUrl(`/api/lobs/${id}`), { method: "DELETE" });
    setLobs(prev => prev.filter(l => l.id !== id));
    if (activeLob?.id === id) {
      const remaining = lobs.filter(l => l.id !== id);
      setActiveLob(remaining[0] ?? null);
    }
  };

  return (
    <LOBContext.Provider value={{ lobs, activeLob, setActiveLob, createLob, renameLob, deleteLob, isLoading }}>
      {children}
    </LOBContext.Provider>
  );
}

export function useLOB(): LOBContextValue {
  const ctx = useContext(LOBContext);
  if (!ctx) throw new Error("useLOB must be used inside LOBProvider");
  return ctx;
}
```

### 2.3 Provider Mounting — `src/main.tsx`

```typescript
// src/main.tsx (diff)
import { LOBProvider } from "@/app/lib/lobContext";

root.render(
  <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
+   <LOBProvider>
      <RouterProvider router={router} />
+   </LOBProvider>
  </ThemeProvider>
);
```

### 2.4 How Page Components Subscribe

Each LOB-aware page needs only two lines of change to connect to the context:

```typescript
// Before (in each page):
const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("voice");
// fetch uses: /api/forecasts?channel=${selectedChannel}

// After:
import { useLOB } from "@/app/lib/lobContext";
const { activeLob } = useLOB();
// fetch uses: /api/forecasts?lob_id=${activeLob?.id}&channel=${selectedChannel}
```

When `activeLob` changes (user switches LOBs), the `useEffect` dependency array will trigger a re-fetch automatically:

```typescript
useEffect(() => {
  if (!activeLob) return;
  fetchForecasts(activeLob.id, selectedChannel);
}, [activeLob, selectedChannel]);
```

### 2.5 Active State Sync for `LongTermForecasting_Demand`

The `demand_planner_active_state` table currently has `organization_id` as its only key. After Phase 1 it uses `(organization_id, lob_id)`. The GET/PUT endpoints will accept `lob_id` as a parameter, and `LongTermForecasting_Demand.tsx` will include `activeLob.id` in its state-sync calls.

---

## Phase 3 — UI/UX Component Architecture

### 3.1 Global LOB Selector — `src/app/components/LOBSelector.tsx`

**Placement:** Inside `PageLayout.tsx` header bar, left of the `ModeToggle`. Persistent across all pages.

**Design:**

```
[ Exordium logo ]  [ Inbound Sales ▼ ]  ········  [ Home ] [ ☀/☾ ]
                      ↑ LOB Selector
```

The selector is a **Radix UI `DropdownMenu`** (already in the project) wrapping the LOB list. Internally it has three sections:

1. **LOB list** — Clicking any item calls `setActiveLob(lob)`. Active LOB shows a checkmark.
2. **Rename** — An inline editable label (double-click to edit, Enter to confirm) or a sub-menu "Rename..." option that opens a small `Dialog`.
3. **Add LOB** — A "+ New Line of Business" item at the bottom that opens a `Dialog` with a single text input.

**Component sketch:**

```
<DropdownMenu>
  <DropdownMenuTrigger>
    <Button variant="outline">
      {activeLob?.lob_name ?? "Select LOB"} <ChevronDown />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    {lobs.map(lob => (
      <DropdownMenuItem key={lob.id} onClick={() => setActiveLob(lob)}>
        {activeLob?.id === lob.id && <Check />}
        {lob.lob_name}
        <Button size="icon" onClick={() => openRenameDialog(lob)}>
          <Pencil />
        </Button>
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={openCreateDialog}>
      <Plus /> New Line of Business
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Visual indicator:** The active LOB name also appears in the Breadcrumbs after the root segment, so users always see their current context:

```
Workforce Management > [Inbound Sales] > Shrinkage Planning
```

### 3.2 Create LOB Dialog

- Triggered by "+ New Line of Business"
- Single `<Input>` for name, `<Button>Create</Button>`
- On success: new LOB is automatically set as active, toast confirms
- Validation: name must be non-empty, unique within org (server returns 409 on conflict)

### 3.3 Rename LOB Dialog

- Triggered by pencil icon next to LOB name in dropdown
- Pre-populated `<Input>` with current name
- On success: name updates in dropdown and breadcrumb in real time
- Cannot rename to empty string or duplicate name

### 3.4 Delete LOB

- Accessible via a "..." overflow menu on the rename dialog (not top-level, to prevent accidental deletion)
- **Confirmation dialog required:** "Delete [LOB Name]? This will permanently remove all forecasts, actuals, shrinkage data, and scenarios for this LOB. This cannot be undone."
- Backend uses `ON DELETE CASCADE` on `lob_id` FK, so all child records are removed atomically
- If user deletes the active LOB, the context automatically switches to the first remaining LOB

### 3.5 Loading State

While `isLoading` is true in `LOBContext`, the `LOBSelector` shows a skeleton/spinner. Page components should gate their data fetches on `activeLob !== null` to prevent requests with undefined `lob_id`.

### 3.6 Backend API Endpoints — LOB CRUD

New endpoints in `server/server.cjs`:

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/lobs` | List all LOBs for org |
| `POST` | `/api/lobs` | Create new LOB (`{ lob_name }`) |
| `PUT` | `/api/lobs/:id` | Rename LOB (`{ lob_name }`) |
| `DELETE` | `/api/lobs/:id` | Delete LOB + cascade all data |

All endpoints scope by `organization_id` from `getCurrentUser()`.

---

## Phase 4 — Mock Data Seeding (2026–2028)

### 4.1 Seed Script Location

**File:** `server/seed_lob_mock_data.cjs`

This is a standalone Node.js script (not part of `ensureAppTables`). Run manually:

```bash
node server/seed_lob_mock_data.cjs
```

### 4.2 LOB Definitions

| LOB | Channels | Direction | Base Daily Volume | AHT Range | Notes |
|-----|----------|-----------|-------------------|-----------|-------|
| **LOB 1: Inbound Sales** | Voice (Inbound), Voice (Outbound), Email | In + Out (voice); Inbound (email) | Voice In: 800/day; Voice Out: 400/day; Email: 250/day | Voice: 240–360s; Email: N/A (AHT = daily backlog model) | High seasonality — peaks Nov–Jan |
| **LOB 2: Technical Support** | Voice (Inbound), Chat (Inbound) | Inbound only | Voice: 1,200/day; Chat: 600/day | Voice: 480–600s; Chat: 300–420s (concurrency 1.8x) | Moderate seasonality; mid-week peak |
| **LOB 3: Digital & Self-Service** | Chat (Inbound) | Inbound only | Chat: 1,500/day | Chat: 180–240s (concurrency 2.5x) | Flat seasonality; peaks Mon AM |

### 4.3 Interval Shape

All channels use **15-minute intervals** (96 per day), `interval_index` 0–95. Volume is shaped using a realistic intraday distribution curve:

- **Voice Inbound:** Bimodal — morning peak 9:00–11:00, afternoon peak 14:00–16:00
- **Voice Outbound:** Unimodal — peaks 10:00–14:00 (outbound dialing window)
- **Email:** Flat across business hours 08:00–17:00 (backlog model)
- **Chat:** Gradual morning ramp, flat plateau 10:00–20:00, sharp evening dropoff

### 4.4 Seasonality Model

Monthly volume multipliers applied on top of base volumes:

| Month | Inbound Sales | Tech Support | Digital |
|-------|--------------|--------------|---------|
| Jan | 1.25 | 0.95 | 0.90 |
| Feb | 0.90 | 0.90 | 0.85 |
| Mar | 0.95 | 1.00 | 0.95 |
| Apr | 0.95 | 1.05 | 1.00 |
| May | 1.00 | 1.10 | 1.05 |
| Jun | 0.90 | 1.05 | 1.10 |
| Jul | 0.85 | 0.95 | 1.15 |
| Aug | 0.90 | 1.00 | 1.10 |
| Sep | 1.00 | 1.10 | 1.00 |
| Oct | 1.10 | 1.15 | 1.00 |
| Nov | 1.30 | 1.05 | 0.95 |
| Dec | 1.40 | 0.90 | 0.90 |

### 4.5 Growth Trend

Year-over-year growth applied before seasonality:
- LOB 1 (Inbound Sales): +8% YoY
- LOB 2 (Tech Support): +5% YoY
- LOB 3 (Digital): +15% YoY

### 4.6 Seed Script Logic (pseudocode)

```javascript
// server/seed_lob_mock_data.cjs

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LOB_DEFINITIONS = [
  { name: 'Inbound Sales', channels: [...] },
  { name: 'Technical Support', channels: [...] },
  { name: 'Digital & Self-Service', channels: [...] },
];

async function seed() {
  // 1. Ensure LOBs exist (upsert)
  const lobIds = {};
  for (const def of LOB_DEFINITIONS) {
    const res = await pool.query(
      `INSERT INTO lobs (organization_id, lob_name)
       VALUES (1, $1) ON CONFLICT (organization_id, lob_name) DO UPDATE SET lob_name = EXCLUDED.lob_name
       RETURNING id`,
      [def.name]
    );
    lobIds[def.name] = res.rows[0].id;
  }

  // 2. For each LOB, for each channel, for each day from 2026-04-01 to 2028-12-31:
  //    - Calculate base volume × YoY growth × monthly seasonality
  //    - Distribute across 96 intervals using intraday shape
  //    - Batch INSERT into interaction_arrival (1000 rows per batch)
  
  // 3. Report rows inserted
}

seed().catch(console.error).finally(() => pool.end());
```

**Date range:** 2026-04-01 to 2028-12-31 = ~1,005 days × 3 LOBs × avg 2.5 channels × 96 intervals ≈ **724,000 rows** (batched in 1,000-row transactions for performance).

### 4.7 Companion Long-Term Actuals Seed

The script will also populate `long_term_actuals` with monthly aggregates (summing interval volumes per LOB/channel/month) so that `LongTermForecasting_Demand.tsx` has realistic actuals to run forecasts against.

---

## Implementation Order

Phases must be executed in order — each phase is a prerequisite for the next.

```
Phase 1 (DB Schema)
  └── Phase 2 (State Management)
        └── Phase 3 (UI Components)
              └── Phase 4 (Mock Data)
```

Within Phase 3, the recommended sub-order is:
1. Backend LOB CRUD endpoints
2. `LOBProvider` context
3. `LOBSelector` header component
4. Update page components (start with `InteractionArrival.tsx` as simplest, end with `LongTermForecasting_Demand.tsx` as most complex)

---

## Open Questions (Resolve Before Phase 1)

1. **Column rename strategy:** Should we rename `channel` → `channel_type`, `volume` → `volume_received`, `aht` → `aht_seconds` in the DB now (clean), or keep old names and alias in queries (safer)? Recommendation: **rename now** since the codebase is small and all usages are in `server.cjs`.

2. **`direction` column default:** For existing Voice records, should `direction` default to `'Inbound'` or `NULL`? Recommendation: `'Inbound'` as default since all existing data is inbound simulation.

3. **LOB delete safety:** Should we soft-delete LOBs (add `deleted_at` column) to allow recovery, or hard-delete with cascade? Recommendation: **hard-delete** for simplicity given current scope. User is warned in the confirmation dialog.

4. **CapacityPlanning `cases` channel:** `CapacityPlanning.tsx` includes a `cases` channel type not present in other pages or the DB seed. Should `cases` be included in the new interval schema or removed? Recommendation: **defer** — keep it in CapacityPlanning UI but exclude from the interval/LOB schema for now.

---

*End of Plan. Awaiting approval to begin Phase 1 implementation.*
