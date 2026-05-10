# Intraday Forecast v2 Architecture

## 1. Why Intraday v2 Exists

The current `/wfm/intraday` implementation has accumulated too much mixed state, page preference persistence, legacy fallback behavior, and UI-derived planning state. This makes channel, LOB, staffing mode, and month scoping fragile.

Intraday Forecast v2 must be built in parallel at `/wfm/intraday-v2` and validated before it replaces the current page. The existing `/wfm/intraday` page must remain untouched during the v2 build until a separate cutover decision is approved.

## 2. Source-of-Truth Rule

Page preferences must not store Intraday planning data.

Allowed page preference usage:
- Selected tab
- Collapsed or expanded sections
- Display density
- Other UI-only state

Disallowed page preference usage:
- Monthly volume
- Manual monthly overrides
- Week allocation data
- Day allocation data
- Interval allocation data
- Published outputs
- Legacy planning fallback values

Intraday planning data must live in proper scoped backend tables and be accessed through scoped backend endpoints.

## 3. Required Scope for All Planning Data

Every Intraday v2 planning record must be scoped by:

```text
organization_id
lob_id
channel
staffing_mode
month_key
```

`month_key` should use `YYYY-MM` format.

This scope must be present on planning records directly, even when records also reference a parent plan ID.

## 4. Business Flow

1. Demand Forecasting produces monthly forecast volume per LOB, channel, and month.
2. Intraday v2 shapes the selected channel's monthly volume into:
   - week-of-month volume
   - day-of-week or calendar-day volume
   - interval-of-day volume
3. Capacity consumes weekly distributed volume later.
4. Scheduling and Real-Time Management consume interval staffing output later.
5. Blended staffing must preserve channel-level volume and combine channels only during interval staffing calculation.

Blended mode must not erase or overwrite channel-level demand. Voice, Email, Chat, and Cases must remain separate through monthly volume resolution and all distribution stages.

## 5. MVP Table Proposal

### Required in Phase 1

#### `intraday_v2_month_plans`

One row per scoped month plan.

Required scope:
- `organization_id`
- `lob_id`
- `channel`
- `staffing_mode`
- `month_key`

Planned fields:
- `id`
- `demand_forecast_volume`
- `demand_source`
- `manual_monthly_volume`
- `effective_monthly_volume`
- `status`
- `created_at`
- `updated_at`

Planned unique constraint:

```text
(organization_id, lob_id, channel, staffing_mode, month_key)
```

#### `intraday_v2_week_allocations`

Stores monthly volume split into weeks.

Required scope:
- `organization_id`
- `lob_id`
- `channel`
- `staffing_mode`
- `month_key`

Planned fields:
- `plan_id`
- `week_start`
- `week_index`
- `weight`
- `volume`
- `is_locked`
- `updated_at`

#### `intraday_v2_day_allocations`

Stores week volume split into calendar days.

Required scope:
- `organization_id`
- `lob_id`
- `channel`
- `staffing_mode`
- `month_key`

Planned fields:
- `plan_id`
- `calendar_date`
- `day_of_week`
- `week_start`
- `weight`
- `volume`
- `is_locked`
- `updated_at`

#### `intraday_v2_interval_allocations`

Stores day volume split into intervals.

Required scope:
- `organization_id`
- `lob_id`
- `channel`
- `staffing_mode`
- `month_key`

Planned fields:
- `plan_id`
- `calendar_date`
- `interval_index`
- `interval_start`
- `interval_minutes`
- `weight`
- `volume`
- `aht_seconds`
- `updated_at`

Interval allocation values are volume or arrival pattern values. They are not FTE.

### Later Output Tables

#### `intraday_v2_weekly_outputs`

Published weekly volume output for Capacity.

Planned fields:
- required scope fields
- `published_plan_id`
- `week_start`
- `volume`
- `published_at`

#### `intraday_v2_interval_outputs`

Published interval volume output for downstream staffing calculation.

Planned fields:
- required scope fields
- `published_plan_id`
- `calendar_date`
- `interval_index`
- `interval_start`
- `interval_minutes`
- `volume`
- `published_at`

#### `intraday_v2_staffing_outputs`

Published staffing output after interval volume is converted into staffing requirement.

Planned fields:
- required scope fields
- `published_plan_id`
- `calendar_date`
- `interval_index`
- `interval_start`
- `interval_minutes`
- `required_fte`
- `staffing_pool`
- `published_at`

This table is where blended staffing output may be represented. It must not replace channel-level volume outputs.

## 6. API Contract Proposal

These endpoints are proposed only. They must not be implemented in Phase 0.

```text
GET  /api/intraday-v2/monthly-source?lob_id=&channel=&staffing_mode=&month_key=
GET  /api/intraday-v2/plans?lob_id=&channel=&staffing_mode=&month_key=
PUT  /api/intraday-v2/plans
PUT  /api/intraday-v2/monthly-override
PUT  /api/intraday-v2/week-allocations
PUT  /api/intraday-v2/day-allocations
PUT  /api/intraday-v2/interval-allocations
POST /api/intraday-v2/import-csv
POST /api/intraday-v2/recalculate
POST /api/intraday-v2/publish
GET  /api/intraday-v2/weekly-outputs?lob_id=&channel=&staffing_mode=&month_key=
GET  /api/intraday-v2/interval-outputs?lob_id=&channel=&staffing_mode=&month_key=
```

Endpoint rules:
- All planning endpoints must require `lob_id`, `channel`, `staffing_mode`, and `month_key`.
- All endpoints must scope by authenticated `organization_id`.
- Invalid channels must be rejected.
- Invalid staffing modes must be rejected.
- The selected channel must be enabled for the selected LOB.
- No endpoint may infer Email, Chat, or Cases data from Voice.
- No endpoint may infer selected-channel data from blended totals.

## 7. Frontend Page Structure

`/wfm/intraday-v2` should be built as a new page in parallel with the current page.

Primary sections:

1. Scope bar
   - LOB
   - Channel
   - Staffing Mode
   - Month
   - Plan status

2. Monthly Volume Source
   - Demand Forecasting volume for the selected LOB, channel, and month
   - Manual override for the selected LOB, channel, staffing mode, and month
   - Effective monthly volume
   - Optional read-only blended total helper

3. Distribution Builder
   - Week allocation
   - Day allocation
   - Interval allocation
   - CSV import scoped to the active planning scope unless the CSV explicitly contains valid scope columns

4. Preview
   - Weekly volume preview
   - Day volume preview
   - Interval volume preview

5. Publish
   - Publish weekly outputs later
   - Publish interval outputs later
   - Publish staffing outputs later

Changing LOB, channel, staffing mode, or month must load only that exact scope. Empty scopes must render as empty, not as previous-scope data.

## 8. Demand Forecasting Adapter Rule

The Demand Forecasting adapter must return selected-channel volume only.

Rules:
- `selectedChannel = voice` returns Voice monthly volume only.
- `selectedChannel = email` returns Email monthly volume only.
- `selectedChannel = chat` returns Chat monthly volume only.
- `selectedChannel = cases` returns Cases monthly volume only.
- Missing selected-channel forecast returns `0` or `null` honestly.
- Voice must never be used as fallback for Email, Chat, or Cases.
- Blended total must never be used as the selected channel's monthly volume.

If the existing Demand Forecasting persistence does not yet expose a normalized monthly output table, Intraday v2 should use a backend adapter over the committed Demand Planner snapshot until a normalized output table is approved.

## 9. Blended Mode Rule

Blended mode must not combine monthly volume early.

Correct sequence:
1. Resolve monthly volume per channel.
2. Shape each channel independently into weeks.
3. Shape each channel independently into days.
4. Shape each channel independently into intervals.
5. Convert interval volume into staffing requirement.
6. Combine channels only during interval staffing requirement calculation.

Blended totals may be shown as read-only helper context, but they must not populate selected-channel planning values.

## 10. Migration Rule

There must be no automatic migration from current Intraday into v2.

Migration principles:
- Legacy data may be imported only through an explicit future import action.
- Legacy unscoped data may map only to Voice / Dedicated.
- Legacy data may map to another channel or staffing mode only when metadata proves that exact scope.
- Legacy import must be previewable before writing v2 records.
- Current `/wfm/intraday` page preference data must not become v2 source-of-truth data.

## 11. Rollback Strategy

Rollback must remain simple because v2 is additive and parallel.

Rollback options:
- Hide `/wfm/intraday-v2` from navigation.
- Leave v2 tables unused.
- Keep current `/wfm/intraday` live.
- Keep Capacity and Scheduling pointed at existing flows until explicit integration is approved.

No destructive rollback should be required.

## 12. Phased Implementation Plan

### Phase 0: Design Doc Only

Create this architecture and contract document. No app code, schema changes, or route changes.

### Phase 1: Additive Backend Tables and Endpoints

Create v2 tables and scoped API endpoints. Do not modify current Intraday behavior.

### Phase 2: `/wfm/intraday-v2` Shell

Create the new route and page shell with scope selection and empty-state behavior.

### Phase 3: Manual Monthly Override

Add selected-channel monthly source resolution and scoped manual monthly override.

### Phase 4: Week, Day, and Interval Editors

Add scoped editors for week, day, and interval distribution.

### Phase 5: Publish Outputs

Publish weekly and interval outputs to v2 output tables. Do not switch downstream consumers yet.

### Phase 6: Parallel Validation

Validate v2 against real planning scenarios while current Intraday remains live.

### Phase 7: Capacity and Scheduling Integration

After approval, integrate Capacity with v2 weekly outputs and Scheduling with approved interval staffing outputs.

## 13. Test Plan

Strict scope tests:
- Voice does not bleed into Email.
- Voice does not bleed into Chat.
- Voice does not bleed into Cases.
- Email does not bleed into Voice, Chat, or Cases.
- Chat does not bleed into Voice, Email, or Cases.
- Cases does not bleed into Voice, Email, or Chat.
- Dedicated does not bleed into Blended.
- Blended does not bleed into Dedicated.
- LOB A does not bleed into LOB B.
- Month A does not bleed into Month B.

Source tests:
- Page preferences cannot restore monthly volume.
- Page preferences cannot restore week allocation data.
- Page preferences cannot restore day allocation data.
- Page preferences cannot restore interval allocation data.
- Missing Email forecast shows `0` or blank, not Voice.
- Missing Chat forecast shows `0` or blank, not Voice.
- Missing Cases forecast shows `0` or blank, not Voice.
- Blended total never becomes selected-channel monthly volume.

API tests:
- Every planning endpoint requires `lob_id`, `channel`, `staffing_mode`, and `month_key`.
- Every planning endpoint scopes by authenticated `organization_id`.
- Invalid channel is rejected.
- Invalid staffing mode is rejected.
- Disabled LOB channel is rejected.
- Slow or stale requests cannot overwrite a newly selected scope.

Output tests:
- Weekly outputs remain channel-specific.
- Interval outputs remain channel-specific.
- Staffing outputs may combine channels only after interval distribution.

Regression boundaries:
- Do not change Demand Forecasting formulas.
- Do not change Capacity formulas.
- Do not change Scheduling formulas.
- Do not change auth, RBAC, or account scope.
- Do not start #20.
- Do not promote `main` to `master`.
