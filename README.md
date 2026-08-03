# Madtrolden 🧌

**A private, remote MCP server that plans cheap weekly meals around live Danish supermarket deals — for friends & family, hosted on Vercel.**

Fork of [tilbudstrolden-mcp](https://github.com/olgasafonova/tilbudstrolden-mcp) by Olga Safonova (MIT), upgraded from a local stdio server to an invite-only remote server with budget-capped planning, nutrition targets, breakfast/lunch coverage, meal-prep scheduling, and Danish store-location awareness.

Family setup guide: **[ONBOARDING.md](ONBOARDING.md)** (Danish).

## What it adds on top of the base repo

| Feature | Tool | What it does |
|---|---|---|
| Remote + invite-only | — | Streamable HTTP MCP on Vercel; per-person access keys; unknown callers get a uniform 401 |
| Budget-capped planning | `plan_week` | Hard DKK cap on the estimated register total; infeasible → cheapest plan + exact gap + what to relax |
| Baseline prices | — | ~155 staple estimates (`data/baseline-prices.json`) fix the base repo's deals-only blindness; deals always win over estimates; estimated totals are labeled |
| Nutrition targets | `plan_week` | kcal/person/day target (±10%), scaled by the share of the day the planned meals cover; per-100g macros from Frida/DTU; un-scored ingredients reported |
| Breakfast + lunch | `plan_week` | 10 + 10 Danish starter templates (`data/breakfast-lunch.json`), `mealType` on all recipes |
| Meal prep | `plan_week` | `meal_prep=true`: cooking consolidated onto cook days (default day 1+4), batchable recipes preferred, portions scaled, every leftover scheduled as a real meal |
| Location awareness | `find_stores_near`, `plan_week` | DAWA geocoding + Tjek branch data: branches near an address with distances; nearby chains rank higher; shopping list shows nearest branch per store |
| Client-held profiles | `import_profile`, `export_profile` | The server stores nothing — the client AI keeps the profile blob between sessions |
| Account info | `whoami` | Which key you're connected with, and whether a profile is loaded |

All base-repo tools still work: `search_deals`, `get_store_offers`, `list_stores`, `deals_this_week`, household/pantry/recipes, `score_recipes`, `generate_shopping_list`, `plan_and_shop`, meal/spend logging.

## Architecture

```
Friend's Claude (claude.ai / Desktop / Code / mobile)
        │  Streamable HTTP MCP + per-person access key
        ▼
Vercel (region arn1) — Next.js App Router
  ├─ /api/mcp .............. MCP endpoint (mcp-handler), auth-gated
  │    Bearer header  OR  path key /api/mcp/<key> (for header-less clients)
  ├─ / ..................... static landing page
  ├─ lib/ .................. all logic (ported from the fork's src/)
  ├─ data/ ................. static JSON shipped with the deploy
  │    baseline-prices.json   nutrition.json   breakfast-lunch.json
  └─ in-memory only:
       deals cache (shared, TTL 6h; dealers/branches 24h)
       per-account profile cache (RAM, TTL ~24h — clients hold the durable copy)
       rate-limit buckets (60/min/key, 300/min global)
        ▼
External (all free, all server-side):
  api.etilbudsavis.dk/v2 ....... deals, dealers, store branches (unofficial Tjek API)
  api.dataforsyningen.dk ....... DAWA — official Danish geocoding, no key
  (build-time only) DTU Data ... Frida food composition → data/nutrition.json
```

**Stateless by design:** no database, no KV, no blob storage, no files written outside `/tmp`. Per-user state lives in the client (see `export_profile`/`import_profile`); the server's RAM cache is convenience only.

## Running it yourself

```bash
npm install
npm test                 # 426 tests
npm run dev:stdio        # local stdio mode (profile in ~/.tilbudstrolden.json)
npm run dev              # Next.js dev server (needs ACCESS_KEYS in .env.local)
```

### Deploy to Vercel

1. `npm run genkey <name>` for each person → collect the `name:key` pairs.
2. Set the env var `ACCESS_KEYS` (Production) to the comma-separated pairs:
   `vercel env add ACCESS_KEYS production` (paste the value; it's stored encrypted).
3. `vercel deploy --prod`.

Malformed `ACCESS_KEYS` entries fail loudly on the first request — a misconfigured server refuses to serve rather than serving unauthenticated.

### Env vars

| Var | Where | What |
|---|---|---|
| `ACCESS_KEYS` | Vercel (encrypted) / `.env.local` | `name:troll_xxx,name2:troll_yyy` — the whole auth system |
| `TILBUDSTROLDEN_DATA` | local only | overrides the stdio-mode profile path |

### Auth model

Friends-and-family scale: shared-secret keys (128-bit, `troll_` + 26 base32 chars), compared as SHA-256 digests with `crypto.timingSafeEqual`, every configured key checked on every attempt. Bearer header preferred; `/api/mcp/<key>` path form for clients that can't set headers (the key then appears in the owner's own Vercel logs — acceptable at this threat model; never in query strings). Logs carry account names and 8-char key fingerprints, never keys.

TODO (deliberately not in v1): proper MCP OAuth.

### Build-time data

```bash
npm run build:nutrition   # regenerates data/nutrition.json from the Frida dataset (python3, stdlib only)
```

The generated JSON is committed, so deploys never depend on external sites.

## Testing

`npm test` — vitest, 426 tests: the base repo's 380 plus profiles (round-trip, cold-start restore, account isolation, no-disk-write sentinel), planner (hard cap, infeasibility, kcal targeting, determinism, meal types, meal prep), nutrition, baseline pricing, and geo/location.

## Credits & data sources

- **[tilbudstrolden-mcp](https://github.com/olgasafonova/tilbudstrolden-mcp)** by Olga Safonova — the entire foundation: Tjek API client, recipe scoring, locales, shopping lists, 32 starter recipes, 380 tests. MIT license, kept intact ([LICENSE](LICENSE)).
- **[eTilbudsavis / Tjek](https://etilbudsavis.dk)** — deal and store-branch data via their unofficial public API. This server caches aggressively and backs off on errors to stay a polite citizen.
- **[Frida — The Danish Food Composition Database](https://frida.fooddata.dk) v6.1**, DTU Fødevareinstituttet, DOI [10.11583/DTU.32312844](https://doi.org/10.11583/DTU.32312844), CC BY 4.0 — nutrition data (`data/nutrition.json` is a derived subset).
- **[DAWA](https://api.dataforsyningen.dk)** (Danmarks Adressers Web API), Klimadatastyrelsen — Danish address geocoding.
- Recipe sources as credited in the base repo (valdemarsro.dk adaptations, Nigel Ng, Maangchi, jarfors.com).
- Baseline staple prices in `data/baseline-prices.json` are **estimates** (source: `"estimates, user-editable"`), not scraped data.

## License

MIT — see [LICENSE](LICENSE). Original work © Olga Safonova; modifications © Ludwig Madsen Barbagallo.
