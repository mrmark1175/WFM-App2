import{j as s,r as p}from"./index-BCgWnhBK.js";import{P as m}from"./PageLayout-Bn3FuPTd.js";const g=`# Auto-Scheduler — User Guide

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
- **LOB Assignments** — check the LOB(s) this agent can work. **Required for auto-generation.** If you skip this the scheduler errors out with "No active agents assigned to this LOB".

**3. Make sure Shrinkage Planning is set** — the scheduler uses \`hours_per_day\` (default 7.5) to align Daily FTE math.

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

> **Important:** Auto-generating DELETES any existing *draft* shifts in that horizon. Already-published shifts are never touched, UNLESS you check **"Also replace PUBLISHED shifts in this horizon"** in the dialog — then they're deleted too before new drafts are created.

### Clearing a week manually
The **"Clear Week"** button (rose-colored, next to Publish Drafts) deletes all shifts for the currently displayed week after confirmation. Choose between *Drafts only* (keeps published) or *All shifts* (drafts AND published). This is useful before re-running auto-generation on a fresh slate.

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

Toast confirms: *"Published N draft shifts"*. Those rows are now \`status='published'\` and won't be overwritten by future auto-generate runs.

---

## Marking agents absent

When an agent cannot report for duty, mark them absent directly in the Schedule Editor without deleting their shift — the schedule record is preserved for reporting purposes.

### How to mark absent

1. **Right-click** the agent's name in the agent column (daily view).
2. Select **"Mark Absent…"** from the context menu.
3. In the dialog, pick a quick type or type your own:
   - **Sick** — unplanned illness
   - **Emergency** — personal/family emergency
   - **NCNS** — No Call No Show
   - Any free-text label your org uses (e.g., *Training*, *Bereavement*, *Suspension*)
4. Click **Mark Absent**.

The shift block immediately changes: **On Queue** segments turn red and display the absence type. **Lunch and break activities are preserved** as-is — standard WFM practice.

### Changing or clearing an absence

Right-click the agent's name again:
- **Change Absence Type…** — opens the dialog pre-filled with the current type.
- **Clear Absence** — restores the shift to normal (green On Queue blocks).

### Saving absences

Absence types are local changes like any other edit. Click **Publish** (top-right) to save them to the database.

> Agents marked absent are visually flagged with red text in the agent name column so supervisors can spot gaps at a glance.

---

## What the auto-scheduler does (rules encoded)

- Each agent gets **one start time for the whole week**.
- Each agent works **5 days, rests 2 consecutive days** (Sun+Mon wrap allowed).
- **Rest days track demand share.** If Monday carries 17.9% of the weekly demand, the scheduler aims to have 17.9% of the total agent-working-days on Monday — so no staffed day ends up empty while another is over-covered. (Best-fit mode.)
- **Closed weekdays are preferred as rest days.** If the channel is closed on Sat+Sun, flexible agents are pushed to rest there first.
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
| Record a same-day absence (Sick / NCNS / etc.) | Right-click agent name → Mark Absent… → pick or type the reason → Publish |
| Undo an absence incorrectly entered | Right-click agent name → Clear Absence → Publish |

---

## Troubleshooting

- **"No approved snapshots"** — Go approve one on Intraday Forecast first.
- **Generation fails with "No active agents assigned to this LOB"** — Check Agent Roster: each agent needs the LOB in their \`lob_assignments\`.
- **Coverage gaps in the draft** — Not enough agents / wrong skills for the demand. Check \`coverage_report\` on the run (stored in DB) or just add headcount.
- **Published shifts showing as drafts** — Only shifts with \`status='published'\` survive Auto-Generate overwrite. Run Publish Drafts after each cycle.
`;function f(c){const t=c.replace(/\r\n/g,`
`).split(`
`),n=[];let e=0;for(;e<t.length;){const a=t[e];if(a.trim()===""){e++;continue}if(/^---+\s*$/.test(a)){n.push({kind:"hr"}),e++;continue}const r=/^(#{1,6})\s+(.*)$/.exec(a);if(r){n.push({kind:"h",level:r[1].length,text:r[2]}),e++;continue}if(a.startsWith(">")){const o=[];for(;e<t.length&&t[e].startsWith(">");)o.push(t[e].replace(/^>\s?/,"")),e++;n.push({kind:"blockquote",text:o.join(" ")});continue}if(/^\s*[-*]\s+/.test(a)){const o=[];for(;e<t.length&&/^\s*[-*]\s+/.test(t[e]);)o.push(t[e].replace(/^\s*[-*]\s+/,"")),e++;n.push({kind:"ul",items:o});continue}if(/^\s*\d+\.\s+/.test(a)){const o=[];for(;e<t.length&&/^\s*\d+\.\s+/.test(t[e]);)o.push(t[e].replace(/^\s*\d+\.\s+/,"")),e++;n.push({kind:"ol",items:o});continue}if(a.startsWith("|")&&e+1<t.length&&/^\|[-:\s|]+\|$/.test(t[e+1])){const o=a.slice(1,-1).split("|").map(l=>l.trim());e+=2;const d=[];for(;e<t.length&&t[e].startsWith("|")&&t[e].trim()!=="";){const l=t[e].slice(1,-1).split("|").map(u=>u.trim());d.push(l),e++}n.push({kind:"table",header:o,rows:d});continue}const i=[a];for(e++;e<t.length&&t[e].trim()!==""&&!/^(#{1,6}\s|-{3,}\s*$|>|\|)/.test(t[e])&&!/^\s*[-*]\s+/.test(t[e])&&!/^\s*\d+\.\s+/.test(t[e]);)i.push(t[e]),e++;n.push({kind:"p",text:i.join(" ")})}return n}function h(c){const t=[];let n=c,e=0;const a=[[/\*\*([^*]+)\*\*/,r=>s.jsx("strong",{className:"font-semibold",children:r[1]},e++)],[/\*([^*]+)\*/,r=>s.jsx("em",{className:"italic",children:r[1]},e++)],[/`([^`]+)`/,r=>s.jsx("code",{className:"px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono",children:r[1]},e++)]];for(;n.length>0;){let r=-1,i=null;for(const[o,d]of a){const l=o.exec(n);l&&(r===-1||l.index<r)&&(r=l.index,i={m:l,render:d})}if(!i){t.push(n);break}i.m.index>0&&t.push(n.slice(0,i.m.index)),t.push(i.render(i.m)),n=n.slice(i.m.index+i.m[0].length)}return t}function b({source:c}){const t=p.useMemo(()=>f(c),[c]);return s.jsx("div",{className:"prose prose-slate max-w-none text-sm leading-relaxed text-foreground",children:t.map((n,e)=>{switch(n.kind){case"h":{const a=n.level===1?"text-3xl font-black mt-0 mb-4 pb-2 border-b":n.level===2?"text-2xl font-bold mt-8 mb-3":n.level===3?"text-lg font-semibold mt-6 mb-2":"text-base font-semibold mt-4 mb-2";return s.jsx("div",{className:a,children:h(n.text)},e)}case"p":return s.jsx("p",{className:"my-3",children:h(n.text)},e);case"ul":return s.jsx("ul",{className:"list-disc pl-6 my-3 space-y-1",children:n.items.map((a,r)=>s.jsx("li",{children:h(a)},r))},e);case"ol":return s.jsx("ol",{className:"list-decimal pl-6 my-3 space-y-1",children:n.items.map((a,r)=>s.jsx("li",{children:h(a)},r))},e);case"blockquote":return s.jsx("blockquote",{className:"my-3 border-l-4 border-amber-300 bg-amber-50/50 pl-4 py-2 text-amber-900 italic",children:h(n.text)},e);case"hr":return s.jsx("hr",{className:"my-6 border-slate-200"},e);case"table":return s.jsx("div",{className:"overflow-x-auto my-4",children:s.jsxs("table",{className:"w-full border-collapse text-sm",children:[s.jsx("thead",{className:"bg-slate-100",children:s.jsx("tr",{children:n.header.map((a,r)=>s.jsx("th",{className:"border border-slate-200 px-3 py-2 text-left font-semibold",children:h(a)},r))})}),s.jsx("tbody",{children:n.rows.map((a,r)=>s.jsx("tr",{className:"hover:bg-slate-50",children:a.map((i,o)=>s.jsx("td",{className:"border border-slate-200 px-3 py-2 align-top",children:h(i)},o))},r))})]})},e)}})})}function w(){return s.jsx(m,{children:s.jsx("div",{className:"max-w-4xl mx-auto py-8 px-6",children:s.jsx(b,{source:g})})})}export{w as HelpAutoScheduler,w as default};
