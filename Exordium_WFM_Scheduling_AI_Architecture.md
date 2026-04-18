# Exordium WFM — Scheduling Module: AI Architecture & Roadmap

**Prepared for:** Mark Rivera  
**Date:** April 7, 2026  
**Context:** Future scheduling feature for Exordium WFM, targeted at BPO companies

---

## 1. The Core Problem: Scheduling ≠ Text Generation

A raw LLM **cannot reliably generate schedules** with hard constraints. LLMs hallucinate — they will produce schedules that look correct on the surface but silently violate labor laws or miss SLA coverage targets. The correct architecture is a **hybrid**:

```
Constraints → [Constraint Solver] → Valid Schedule → [LLM] → Plain-English Explanation
```

The solver handles the math. The LLM handles the communication.

---

## 2. Recommended Stack (Mostly Free)

### Component 1 — The Scheduler: Google OR-Tools

| Property | Detail |
|---|---|
| **Cost** | Free forever (Apache 2.0 open-source) |
| **Built by** | Google |
| **Used by** | Enterprise WFM vendors (NICE, Verint, Genesys) under the hood |
| **What it does** | Constraint satisfaction + combinatorial optimization |
| **Performance** | Solves a 50-agent, 1-week schedule in seconds |

OR-Tools handles hard constraints perfectly:

- Shift coverage rules (FTE required per interval to meet SLA)
- Labor law hours caps (daily/weekly maximums per jurisdiction)
- Agent-specific restrictions (availability windows, accommodations)
- Consecutive days worked limits
- Skill matching (which agents can handle which channels/LOBs)
- Soft constraints (minimize overtime, maximize SLA attainment)

**Implementation shape (Python):**

```python
from ortools.sat.python import cp_model

model = cp_model.CpModel()

# Decision variables: shifts[agent][day][shift_type] = boolean
shifts = {
    (a, d, s): model.NewBoolVar(f"shift_a{a}_d{d}_s{s}")
    for a in agents for d in days for s in shift_types
}

# Hard constraint: each interval must meet SLA FTE requirement
for interval in coverage_requirements:
    model.Add(
        sum(shifts[a, interval.day, s]
            for a in agents
            for s in shift_types if s.covers(interval))
        >= interval.required_fte
    )

# Hard constraint: labor law — max 8 hrs/day, 40 hrs/week
for agent in agents:
    for week in weeks:
        model.Add(sum(hours(shifts[agent, d, s]) for d in week for s) <= 40)

# Soft objective: minimize overtime cost
model.Minimize(total_overtime_cost)

solver = cp_model.CpSolver()
status = solver.Solve(model)
```

---

### Component 2 — The AI Layer: LLM for Language, Not Math

The LLM's role is **not** to generate the schedule. Its jobs are:

| Task | What the LLM does |
|---|---|
| **Rule parsing** | Translate "no agent works more than 3 overnight shifts per month" → structured constraint object |
| **Schedule explanation** | "Agent Maria was given Tuesday off because she hit her accommodation hours limit after Monday's shift" |
| **Conflict reporting** | "SLA cannot be met in the 9–10 AM window — 2 additional agents are required" |
| **What-if narrative** | "Adding 3 agents to Friday morning raises projected SLA from 78% to 92%" |
| **Compliance summary** | "All assignments comply with DOLE regulations for this week" |

---

## 3. Free LLM Options — Ranked for This Use Case

| Option | Cost | Privacy | Speed | Recommended For |
|---|---|---|---|---|
| **Ollama + Llama 3.2 / Mistral** | Free forever | 100% private (your server) | Fast on modest GPU/CPU | Rule parsing, explanation, BPO client demos |
| **Google Gemini Flash** | Free tier: 1M tokens/day | Cloud (Google) | Very fast | Rule parsing, NL output |
| **Groq (Llama 3.3 70B)** | Free tier (rate-limited) | Cloud (Groq) | Fastest available | Quick explanations |
| **Claude API — Haiku 4.5** | ~$0.25 per 1M tokens | Cloud (Anthropic) | Fast | Most accurate constraint reasoning |

### Winner for a BPO SaaS Product: **Ollama**

Ollama runs entirely on your server. Zero cost per API call. No data leaves the client's environment. You can tell prospective BPO clients:

> *"All AI processing runs on your private infrastructure. No schedule data, agent data, or labor rules are transmitted to any third-party service."*

This is a significant enterprise selling point — the same positioning already built into the **Exordium Private AI Engine** branding in the app.

---

## 4. Implementation Roadmap

### Phase 1 — Solver Only (No LLM Required)

1. Add a Python FastAPI microservice at `server/scheduler/main.py`
2. Expose `POST /api/generate-schedule` from Express, which proxies to the Python service
3. **Input:** Required FTE per interval (from Intraday Forecast → Required FTE table), agent roster, shift templates, constraint rules
4. **Output:** Shift assignments per agent per day
5. Display the generated schedule in a new Schedule Builder page

### Phase 2 — LLM Explanation Layer

1. After the solver runs, pass the output + any unmet constraints to Ollama/Gemini
2. Prompt the LLM: *"Given these schedule assignments and these constraint violations, write a plain-English summary for an operations manager"*
3. Render the narrative in the UI using the same **Insight Narrative** pattern already built on the Demand Planning page

### Phase 3 — Natural Language Rule Input

1. Allow planners to type rules in plain English:
   - *"No agent should work more than 3 overnight shifts per month"*
   - *"Agents on accommodation plans cannot be scheduled before 8 AM"*
2. LLM parses the input → structured constraint object → passed to the solver
3. Rules are stored in the database and reused across planning cycles

---

## 5. Prerequisites to Build First (in the Existing App)

Before the scheduler can function, these data modules must exist:

| Module | Purpose | Status |
|---|---|---|
| **Agent Roster** | Agents, skills, contract type, accommodation flags, availability windows | Not yet built |
| **Shift Template Library** | Shift patterns (start/end, break rules, channel coverage) | Not yet built |
| **Labor Law Rules Table** | Per-jurisdiction rules — Philippines (DOLE), US (FLSA), India, etc. | Not yet built |
| **Coverage Requirement Feed** | Required FTE per interval by day | ✅ **Already built** — Intraday Forecast → Required FTE table |

> The **Required FTE per Interval** table on the Intraday Forecast page is the **direct input feed** to the scheduler. This was the right architectural decision — no rework needed.

---

## 6. Key Constraint Categories for BPO Scheduling

| Category | Examples |
|---|---|
| **SLA Attainment** | Must staff ≥ N agents per interval to hit 80/20 SLA |
| **Labor Law — Philippines** | Max 8 hrs/day, 48 hrs/week, 1 rest day per week (DOLE) |
| **Labor Law — US** | Overtime after 40 hrs/week (FLSA); state-level meal/rest break rules |
| **Labor Law — India** | Max 9 hrs/day, 48 hrs/week; mandatory weekly off |
| **Accommodations** | No night shifts, limited consecutive days, ergonomic break schedules |
| **Agent Restrictions** | Declared unavailability, training blocks, approved leave |
| **Skill Matching** | Only voice-trained agents on voice queues; bilingual agents on LATAM queues |
| **Shift Fairness** | Equitable distribution of undesirable shifts (overnight, weekends) |

---

## 7. Summary

| Decision | Recommendation |
|---|---|
| Schedule generation engine | **Google OR-Tools** (free, reliable, production-grade) |
| LLM for natural language | **Ollama (local)** for privacy + zero cost; Gemini Flash as cloud fallback |
| LLM's role | Explanation, rule parsing, conflict narrative — NOT schedule generation |
| Integration pattern | Python FastAPI microservice called by Express backend |
| First prerequisite to build | Agent Roster table and Shift Template Library |
| Input already ready | Required FTE per Interval (Intraday Forecast page) |

---

*Document generated by Exordium WFM development session — April 7, 2026*
