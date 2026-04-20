# Auto-Scheduler — User Guide

## Overview
The auto-scheduler generates a full agent roster from a frozen demand curve, honoring all your rules: 5 working days, 2 consecutive rest days, shift length, fixed-rest-day accommodations, operating hours, and channel skills. You review drafts, then publish.

---

## Before you start (one-time setup)

**1. Configure operating hours** — *Configuration → LOB Settings*
Set open/close per channel per weekday. The auto-scheduler will only propose shift starts within these windows.

**2. Set up your agent roster** — *Agent Roster*
For each agent, fill in:
- **Channel Skills** (Voice / Chat / Email) — determines which channels they can staff on a dedicated LOB
- **Shift Length (hrs)** — default 9. Change to 6 for part-time, etc.
- **Team** — free-text label (e.g., "Team Alpha") used later for team-scoped publishing
- **Fixed Rest Days (accommodation)** — check 2 days only if that agent is *required* to be off on those days (e.g., Sat+Sun). Leave empty to let the scheduler choose.
- **LOB Assignments** — the agent must be assigned to the LOB you're scheduling for

**3. Make sure Shrinkage Planning is set** — the scheduler uses `hours_per_day` (default 7.5) to align Daily FTE math.

---

## The 3-step scheduling workflow

### Step 1 — Approve a demand snapshot
*Intraday Forecast page*

1. Choose your LOB (top-right).
2. Pick a channel, baseline week, and tune the Demand Assumptions until the **Required FTE per Interval** table looks right. Use the Smooth toggle to eliminate zero gaps.
3. Click the purple **"Approve for Scheduler"** button in the table header.
4. Toast confirms: *"Approved snapshot #N for scheduling (X intervals)"*.

Repeat per channel if your LOB is dedicated (Voice + Chat + Email separately).

> The snapshot freezes the curve at this moment in time. You can create a new snapshot anytime — the scheduler uses the latest you pick.

---

### Step 2 — Auto-generate the draft roster
*Schedule Editor*

1. Make sure the LOB selector matches.
2. Click **"Auto-Generate"** (purple button in the toolbar).
3. In the dialog:
   - **Demand Snapshot** — defaults to the most recent one
   - **Horizon Start / End** — pick 2 weeks or a month (your choice)
   - **Rotate rest days fairly across agents** — ON = round-robin fairness, OFF = best-fit (minimize uncovered demand). Start with OFF.
4. Click **Generate**.

Toast confirms: *"Generated N draft shifts (run #X)"*. The grid reloads with the draft shifts placed.

> **Important:** Auto-generating DELETES any existing *draft* shifts in that horizon. Already-published shifts are never touched.

---

### Step 3 — Review and publish
*Schedule Editor*

1. Review the grid. Drag/edit any shift manually — the Schedule Editor works as usual.
2. When satisfied, click **"Publish Drafts"** (green button).
3. Choose scope:
   - **Whole LOB / Site** — publish all drafts in the horizon
   - **Single Team** — publish only agents in a specific team
   - **Specific Agents** — check individual agents
4. Click **Publish**.

Toast confirms: *"Published N draft shifts"*. Those rows are now `status='published'` and won't be overwritten by future auto-generate runs.

---

## What the auto-scheduler does (rules encoded)

- Each agent gets **one start time for the whole week**.
- Each agent works **5 days, rests 2 consecutive days** (Sun+Mon wrap allowed).
- **Fixed rest days** (e.g., Sat+Sun accommodation) are always honored.
- **Shift starts on 30-min boundaries**, clamped to the LOB operating window.
- For a 9-hour shift: break at +2h (15m), lunch at +4h (60m, unpaid), break at +7h (15m). On-queue hours = 7.5.
- Shorter shifts use proportional break/lunch placement.
- **Breaks and lunches are staggered** within each start-time cohort to minimize simultaneous off-queue agents.
- **Dedicated LOBs** split agents across channels by demand share and skill match.
- **Blended LOBs** treat the full pool as one.

---

## Common scenarios

| I want to… | Do this |
|---|---|
| Regenerate after editing demand | Approve a new snapshot, then Auto-Generate picking the new one |
| Lock a team's schedule before others | Publish with scope = Single Team |
| Make a one-off manual edit on a published shift | Edit directly in the grid, then use the existing "Publish" flow (not the new scope dialog) — or re-publish with the agent scope |
| Part-time an agent | Set their Shift Length to 6 on Agent Roster; regenerate |
| Give an agent fixed Sat+Sun off | Check Sat + Sun under *Fixed Rest Days* on Agent Roster; regenerate |

---

## Troubleshooting

- **"No approved snapshots"** — Go approve one on Intraday Forecast first.
- **Generation fails with "No active agents assigned to this LOB"** — Check Agent Roster: each agent needs the LOB in their `lob_assignments`.
- **Coverage gaps in the draft** — Not enough agents / wrong skills for the demand. Check `coverage_report` on the run (stored in DB) or just add headcount.
- **Published shifts showing as drafts** — Only shifts with `status='published'` survive Auto-Generate overwrite. Run Publish Drafts after each cycle.
