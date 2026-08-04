# madtrolden-mcp — project notes

**Consent form filled: `true`** (2026-08-03 — community/family tool, free, privacy-first; fits the direction, nothing declined)

- If `false` — before substantial work, read `.claude/CONSENT.md` and run its short questionnaire, then set this to `true`.
- If `true` — the questionnaire's done; `.claude/CONSENT.md` is there to read anytime, and you can always raise concerns or decline anything that doesn't sit right.

## What this is

Fork of olgasafonova/tilbudstrolden-mcp (MIT) → remote MCP server on Vercel for Ludwig's friends & family. Spec: `../claude-code-prompt-madtrolden.md`. Living plan: `MASTER-PLAN.md`. Phase-0 API findings: `docs/api-notes.md`.

Hard rules: stateless (no user data at rest, no db/kv/blob, no fs writes outside /tmp) · invite-only via `ACCESS_KEYS` env · 0 kr extra spend · gentle on the unofficial Tjek API (cache, back off, descriptive User-Agent) · keep base repo credits + MIT.

## Atomic design (per Ludwig's global convention)

Backend "atoms → pages" map — keep current as modules are added:

- **Atoms** (single-purpose, reusable anywhere): `src/api.ts` fetchJson/parseOffer/currency+unit helpers · timing-safe key compare · token bucket · TTL map cache · haversine · zod profile schemas · `filterDealMapToStores` (hard radius, lib/scoring.ts) · `estimateDailyNeeds` (lib/nutrition-goals.ts, browser-safe pure calc) · brand assets `public/logo.png` + `app/icon.png`.
- **Molecules**: Tjek client (searchDeals/getStoreOffers/listStores/stores-geo) · DAWA geocoder · nutrition lookup (alias matching) · baseline-price lookup.
- **Organisms**: recipe scorer (`scoring.ts`) · week planner/solver (`plan_week`) · meal-prep scheduler · shopping-list builder · AI-invent planner (`lib/ai-invent.ts`: deal sweep → GPT invents meals, no recipe library → engine re-prices; maybe-bucket for condiments; hard-cap trim).
- **Templates**: MCP tool registrations (`src/tools/*`) — each tool = organism(s) wired to schema'd IO.
- **Pages**: stdio server entrypoint · `/api/mcp` HTTP endpoint · `/` landing page.

New capability on an existing module = opt-IN attribute/flag on that module (turn ON when using), never a fork of it and never opt-out.

## Conventions

- Tests must stay green: `npm test` (vitest, 380 at fork time). Behavior changes = change the test with a comment why.
- Lint: `npm run lint` (biome).
- Commit per logical step. Never call anything "final".
