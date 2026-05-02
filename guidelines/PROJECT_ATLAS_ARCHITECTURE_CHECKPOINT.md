# Project Atlas Architecture Checkpoint

## 1. Project Identity

- Project Atlas is the internal codename for this build.
- Exordium remains the external product and customer-facing brand.

## 2. Current Branch And Deploy State

- `main` is the active deployed branch.
- `main` has been deployed and smoke-tested.
- Render currently deploys from `main`.
- `master` is stale and should not be promoted casually. Treat any `main` to `master` promotion as a full release decision.

## 3. Current Architecture

- Organization is the tenant/customer boundary.
- Account is the BPO client/program layer under Organization.
- LOB is the operational line under Account.
- `organization_id` remains the active tenant security boundary.
- `account_id` is additive/foundation-only for now. It should not drive access control until account-level scoping is designed and reviewed.

## 4. Completed Security/Foundation Work

- Secure environment handling with fail-fast behavior for missing required secrets.
- AI API keys are encrypted at rest with AES-256-GCM.
- Authentication is fail-closed; unauthenticated traffic no longer falls back to org 1.
- Hardcoded route behavior using `organization_id = 1` has been replaced with `req.user.organization_id`.
- Additive accounts schema layer exists: Organization -> Account -> LOB.
- Protected API requests re-check `users.is_active`.
- DELETE routes return 404 when zero rows are affected.

## 5. Deployment Requirements

- Render deploys from `main`.
- Build command: `npm run build`.
- Start command: `npm run start`.
- Required production environment includes database connection settings and auth/encryption secrets, including `DATABASE_URL` or PG connection variables, `SESSION_SECRET`, and `KEY_ENCRYPTION_KEY`.
- Known gotcha: the build requires dev dependencies because Vite and related build tooling are in `devDependencies`.

## 6. Remaining Backlog

- #20 Account-level scoping.
- #21 Harden `lobs.account_id`.
- #22 Account management admin UI.

## 7. Guardrails

- Do not remove `organization_id` yet.
- Do not make `lobs.account_id` `NOT NULL` yet.
- Do not start #20 without a design review.
- Do not change auth or RBAC casually.
- Keep future PRs small and reversible.
- Avoid mixing cleanup, schema, auth, deployment, and product behavior changes in one PR.

## 8. Next Safe PR Guidance

- The next safe PR should be documentation or design-only unless explicitly approved otherwise.
- Before coding #20, produce an account-level scoping design that inventories affected routes, tables, API contracts, permissions, migration steps, and smoke tests.
- Preserve `organization_id` as the tenant boundary while designing account scope as an additional filter.
- Treat #21 and #22 as dependent on the accepted #20 design.
