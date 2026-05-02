# Project Atlas MVP Checklist

Project Atlas is the internal codename for the Exordium WFM SaaS build. Exordium is the external customer-facing product brand.

## 1. MVP Goal

Exordium must prove that a small-to-mid BPO or WFM team can run a credible workforce management workflow without expensive enterprise WFM tooling or live telephony API access.

The MVP should support manual or imported data first, then layer automation later. The pilot product should be useful for teams that need forecasting, staffing, scheduling, adherence visibility, and basic operational reporting before they are ready for deep integrations.

### Pilot Exit Criteria

- A pilot admin can set up an organization, users, LOBs, and demo operating assumptions without engineering help.
- A WFM planner can build a demand forecast and capacity plan from manual or imported data.
- A scheduler can generate, edit, publish, and review schedules.
- An agent can view their schedule and manually punch status.
- An RTA can monitor schedule versus actual status during the day.
- Leadership can view or export basic results.
- AI assistance can be configured securely.
- No known cross-tenant data access path exists.

## 2. Core MVP Modules

- Demand Forecasting
- Capacity Planning
- Scheduling
- Real-Time Management
- Manual Adherence / Agent Self-Service
- Reporting / Insights
- AI Assistant / Insights
- Admin / Users / Roles
- LOB / Account Setup

## 3. Must-Have vs Nice-To-Have

### Demand Forecasting

- Must-have for pilot: create forecasts from manual or imported historical demand, adjust assumptions, and save scenarios by organization and LOB.
- Nice-to-have later: automated telephony imports, advanced seasonality tuning, and multi-source forecast comparison.
- Not needed yet: real-time external queue ingestion.
- Current State: forecasting workflows exist and are database-backed.
- Pilot Gap: confirm one clean planner workflow from raw/manual input to saved forecast and exportable output.

### Capacity Planning

- Must-have for pilot: convert forecast demand into staffing/FTE requirements using clear assumptions.
- Nice-to-have later: richer what-if libraries, scenario approvals, and advanced financial modeling.
- Not needed yet: customer-specific workforce finance customization.
- Current State: capacity planning and what-if modeling exist.
- Pilot Gap: validate pilot-ready defaults, readable outputs, and simple explanation of required FTE calculations.

### Scheduling

- Must-have for pilot: generate schedules, edit shifts, publish schedules, and support basic schedule review.
- Nice-to-have later: optimization constraints, advanced fairness rules, and automated shift bidding.
- Not needed yet: enterprise-grade scheduling optimization.
- Current State: schedule editor, generation, templates, and published schedule views exist.
- Pilot Gap: verify end-to-end flow from demand/capacity input to published agent schedule.

### Real-Time Management

- Must-have for pilot: show scheduled staffing versus actual status and basic intraday gaps.
- Nice-to-have later: live telephony queue integrations, automated alerts, and advanced service-level simulations.
- Not needed yet: full real-time command center automation.
- Current State: hybrid real-time management dashboard exists.
- Pilot Gap: ensure manual/adherence data can drive a useful RTA demo without external integrations.

### Manual Adherence / Agent Self-Service

- Must-have for pilot: agents can view schedules and manually punch statuses; supervisors or RTAs can review and correct records.
- Nice-to-have later: mobile polish, notifications, and payroll/export integration.
- Not needed yet: biometric, desktop activity, or workforce device integrations.
- Current State: manual adherence tracking and agent self-service views exist.
- Pilot Gap: confirm role-based flows for agent, RTA, supervisor, and admin are clear and reliable.

### Reporting / Insights

- Must-have for pilot: basic exports, operational summaries, and before/after pilot metrics.
- Nice-to-have later: custom dashboards, scheduled email reports, and executive scorecards.
- Not needed yet: full BI platform replacement.
- Current State: several planning and operational screens expose useful metrics.
- Pilot Gap: define the minimum pilot report pack and make sure it can be exported or captured consistently.

### AI Assistant / Insights

- Must-have for pilot: secure AI configuration and useful contextual assistance for interpreting planning data.
- Nice-to-have later: proactive recommendations, multi-step workflow automation, and provider-specific tuning.
- Not needed yet: autonomous planning changes or unsupervised operational decisions.
- Current State: AI settings and assistant infrastructure exist; API keys are encrypted at rest.
- Pilot Gap: define safe demo prompts, failure states, and which pages should provide structured context.

### Admin / Users / Roles

- Must-have for pilot: create users, assign roles, deactivate users, and prevent inactive users from continuing API access.
- Nice-to-have later: invitation emails, SSO, audit dashboards, and granular permissions.
- Not needed yet: enterprise identity federation.
- Current State: user and role administration exists with active-user enforcement.
- Pilot Gap: verify each pilot role can access exactly the workflows needed and no more.

### LOB / Account Setup

- Must-have for pilot: create and manage LOBs; preserve organization tenant isolation.
- Nice-to-have later: account management UI and account-aware workflows.
- Not needed yet: full enterprise account-level scoping.
- Current State: Organization -> Account -> LOB schema foundation exists; `organization_id` remains the active tenant boundary and `account_id` is additive/foundation-only.
- Pilot Gap: provide a clear setup path that does not depend on unfinished account-level scoping.

## 4. Pilot Readiness Checklist

- Can create organization/BPO.
- Can create LOBs.
- Can create or import agents.
- Can build forecast.
- Can create capacity plan.
- Can generate and edit schedules.
- Can publish schedules.
- Can view schedule as agent.
- Can manually punch status.
- Can RTA monitor schedule versus actual.
- Can export or report basic results.
- Can configure AI securely.
- Can prevent cross-tenant data leaks.

## 5. Demo Readiness Checklist

- Demo data exists for a realistic BPO workflow.
- Demo users exist for admin, WFM planner, scheduler, RTA, supervisor, and agent roles.
- Sample LOBs and accounts are defined.
- Sample schedules are generated and publishable.
- Sample RTM/adherence data is available.
- Sales-call demo script exists.
- Demo limitations are known before the call.

## 6. Operational Readiness Checklist

- Deployment is stable.
- Required environment variables are documented.
- Backup and rollback process is documented.
- User onboarding steps are documented.
- Basic support process is defined.
- Known limitations are documented.
- Smoke-test checklist exists for each release.

## 7. Security/Trust Checklist

- Tenant isolation is verified around `organization_id`.
- Role permissions are checked server-side for admin actions.
- Active-user enforcement is working for protected API requests.
- AI keys are encrypted at rest.
- No secrets are committed or exposed in docs/build output.
- Audit trail gaps are documented.
- Account-level scoping remains design-only until #20 is reviewed.

## 8. Go-To-Market Checklist

- Pricing model is drafted.
- Target customer profile is specific.
- Pilot offer is defined.
- Case study metrics are selected before pilot start.
- LinkedIn/demo material is prepared.
- Sales demo script maps product screens to customer pain points.
- Pilot feedback process is defined.

## 9. Recommended Build Priority

1. Stabilize demo and pilot workflows with manual/imported data.
2. Define pilot report pack and exports.
3. Document onboarding, deployment, rollback, and support processes.
4. Review role-based access for pilot personas.
5. Create a design-only plan for #20 account-level scoping.
6. Build #20 only after design review.
7. Address #21 and #22 after the #20 design is accepted.

## 10. Non-Goals

- Full enterprise account-level scoping before #20 design review.
- Deep telephony integrations.
- Complex billing system.
- Advanced multi-region enterprise controls.
- Over-customized customer-specific features.
- Autonomous AI changes to schedules, staffing plans, or user permissions.
- Enterprise SSO or identity federation.
