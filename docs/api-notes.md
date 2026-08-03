# Phase 0 — Live API probe notes (2026-08-03)

All four data sources probed with curl before any code. Everything below is verified live behavior, not docs.

## 1. Tjek / eTilbudsavis `api.etilbudsavis.dk/v2` (unofficial, no auth)

### `/offers/search` — WORKS, matches `RawOffer`
`GET /v2/offers/search?query=hakket%20oksekød&limit=2&country_id=DK`
- Response is a bare JSON array of offers. Shape matches `src/api.ts` `RawOffer` exactly:
  `id`, `heading`, `description`, `pricing{price, pre_price, currency}`,
  `quantity{unit{symbol, si}, size{from,to}, pieces{from,to}}`,
  `branding{name}`, `dealer_id`, `dealer{name, country{id}}`, `run_from`, `run_till`, `images{view,thumb,zoom}`.
- Extra fields present we don't parse yet (harmless): `ern`, `catalog_page`, `publish`, `dealer_url`, `links.webshop`.
- Live sample: REMA 1000 hakket oksekød 400 g @ 29 kr, valid 2026-08-01 → 2026-08-08.

### `/dealers` — WORKS
`GET /v2/dealers?country_id=DK&limit=100` → 100 dealers (cap appears to be 100/page). Includes non-grocery (byggecenter, planteskole etc.) — the existing DK allow-list filter approach stays correct.

### `/stores` — WORKS, better than hoped
`GET /v2/stores?r_lat=55.667&r_lng=12.545&r_radius=3000&limit=3&country_id=DK` → HTTP 200.
- Geo params `r_lat`, `r_lng`, `r_radius` (meters) are honored — returns physical branches near the point.
- `dealer_id=<id>` also works (all branches of one chain), combinable with geo params.
- Per store: `id`, `street`, `city`, `zip_code`, `name`, `latitude`, `longitude`, `dealer_id`,
  `branding{name, logo, color}`, full `opening_hours` per weekday, embedded `dealer` object.
- Consequence for §6.5: no per-dealer fetch + local haversine needed for the primary path; one geo query does it.
  Keep haversine as sort key / fallback (API does not clearly sort by distance).

## 2. DAWA `api.dataforsyningen.dk` (official, no key)

### `/adresser` — WORKS
`GET /adresser?q=Istedgade 50, København&struktur=mini&per_side=2`
→ `x` (lng), `y` (lat), `betegnelse`, `postnr`, `postnrnavn`, `kommunekode`. Note: **x=longitude, y=latitude** (WGS84).

### `/autocomplete` — WORKS
`GET /autocomplete?q=Istedgade 50&type=adresse&per_side=2`
→ `[{tekst, data:{x, y, ...}}]`. Good for fuzzy address input; use this as the primary geocoder, `/adresser` as structured fallback.

## 3. Frida — Danish Food Composition Database (DTU)

- `frida.fooddata.dk` now redirects to `https://fcdb.fooddata.dk` (Angular SPA; its JSON API sits behind an antiforgery-token handshake — not for us).
- **The dataset itself is published on DTU Data (Figshare): DOI `10.11583/DTU.32312844` — "The Danish Food Composition Database, version 6.1", license CC BY 4.0.**
- Direct downloads (via Figshare API `api.figshare.com/v2/articles/32312844`):
  - `FCDB_6.1_Dataset.xlsx` — https://ndownloader.figshare.com/files/65016537 (12.6 MB)
  - Documentation PDFs (da/en) alongside.
- CC BY 4.0 → we may redistribute the derived `data/nutrition.json` with attribution:
  "Data from The Danish Food Composition Database v6.1, DTU Fødevareinstituttet, DOI 10.11583/DTU.32312844, CC BY 4.0."
- Build script downloads the xlsx from the ndownloader URL, extracts kcal/protein/fat/carbs per 100 g for ~200–300 common ingredients, commits the JSON.

## 4. MCP transport package

- `mcp-handler` is the current npm name (v2.1.0, "Framework-agnostic HTTP adapter for Model Context Protocol servers"). `@vercel/mcp-adapter` (0.3.2) is the old name — do not use.
- Base repo uses `@modelcontextprotocol/sdk` ^1.28.0; latest is 1.30.0.

## Base repo state

- `npm install && npm test`: **380/380 passing** (11 files, vitest), Node v22.
- Tool sources live in `src/tools/` (deals, household, recipes, scoring, shopping, tracking, shared) + `src/{api,store,locales,scoring,prompts,default-recipes}.ts`.

## Contradictions with the spec

None blocking. One positive deviation: §6.5's "if geo params are unsupported, fetch per dealer and filter locally" fallback is unnecessary — geo params are supported. Haversine still used for distance display/sorting.
