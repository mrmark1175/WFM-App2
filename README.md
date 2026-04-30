# Exordium WFM

Workforce management application for demand forecasting, capacity planning, intraday forecasting, scheduling, roster management, and administrative configuration.

## Stack

- Vite + React + TypeScript frontend in `src/`
- Express/CommonJS backend in `server/`
- Committed production build output in `dist/`
- Supabase/Postgres-oriented backend helpers and migration scripts

## Common Commands

```bash
npm install
npm run dev
npm run start
npm run build
```

- `npm run dev`: starts the Vite frontend. API calls to `/api` proxy to `http://localhost:5000`.
- `npm run start`: starts the Express backend from `server/server.cjs`.
- `npm run build`: generates the production bundle in `dist/`.
- `npm run check`: currently aliases the production build and is the default pre-push sanity check.
- `npm run migrate:supabase`: runs the Supabase migration helper.

## Repository Layout

- `src/app/pages`: page-level WFM screens.
- `src/app/components`: shared layout, UI primitives, and feature components.
- `src/app/lib`: frontend context, API URL helpers, and shared client utilities.
- `src/styles`: global Tailwind/theme styles.
- `server`: Express API, auth, Genesys integration, migration, and scheduling backend code.
- `guidelines`: project-specific implementation guidance.
- `dist`: generated production output. Rebuild it instead of editing by hand.

## Development Notes

- Keep secrets in `.env`; it is ignored by git.
- Match the surrounding file style. There is no repo-level formatter configured yet.
- Add or update tests when changing forecasting math, route behavior, or data-entry flows.
- Do not hand-edit generated bundle files under `dist/`; run `npm run build`.
