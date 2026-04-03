# Repository Guidelines

## Project Structure & Module Organization
This repository is a Vite-based React + TypeScript frontend with an Express backend. Frontend code lives in `src/`: route setup in `src/app/routes.tsx`, page-level screens in `src/app/pages`, shared layout and primitives in `src/app/components`, styles in `src/styles`, and static assets in `src/assets`. Backend scripts and API entrypoints live in `server/*.cjs`. Generated build output is committed under `dist/`; treat it as build output, not a hand-edited source folder. Project-specific AI guidance lives in `guidelines/`.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start the Vite dev server. `/api` requests proxy to `http://localhost:5000`.
- `npm run start`: run the Express server from `server/server.cjs`.
- `npm run build`: produce a production bundle in `dist/`.
- `npm run migrate:supabase`: run the Supabase migration helper.

## Coding Style & Naming Conventions
Use TypeScript/TSX for frontend changes and CommonJS (`.cjs`) in `server/`. Follow the existing 2-space indentation and keep imports grouped cleanly. Use PascalCase for React components and page files (`InteractionArrival.tsx`), camelCase for helpers (`forecasting-logic.ts` is the existing exception), and `*.test.ts` or `*.test.tsx` for tests. Prefer the `@` alias for imports from `src` when paths get deep. There is no repo-level ESLint or Prettier config, so match the surrounding file's quote and semicolon style instead of reformatting unrelated code.

## Testing Guidelines
Current tests live beside feature files, for example `src/app/pages/InteractionArrival.test.tsx` and `src/app/pages/LongTermForecasting.test.ts`. They use Vitest-style APIs and Testing Library patterns. Add or update tests when changing forecasting logic, route behavior, or data-entry flows. No `npm test` script is defined yet; if you add test execution, keep it scriptable from `package.json`.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects such as `Persist demand scenarios and load DB history` and `Use same-origin API URLs in production`. Keep commits focused and descriptive. Pull requests should summarize user-visible changes, list any API or schema impact, note new environment variables or migration steps, and include screenshots for UI changes. If `dist/` changes, mention whether it was intentionally rebuilt.

## Configuration Notes
Keep secrets in `.env`, which is ignored. Do not commit credentials, ad hoc debug logs, or local editor files beyond the existing repo setup.
