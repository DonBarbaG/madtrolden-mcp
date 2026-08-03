# madtrolden-mcp — MASTER PLAN (the one living list)

**Progress: 19 / 34 done — ~56%** (task-count, each item = 1; last updated 2026-08-03)
Legend: [ ]/[x] · owner [you]/[me]/[both] · ⏾ = Claude can run unattended · ~NN% partial.
Guiding principles (not tasks): stateless server, no user data at rest, ever · invite-only, unknown callers learn nothing · 0 kr extra spend · be a good citizen to the Tjek API · keep base repo credits + MIT intact.

Spec: `../claude-code-prompt-madtrolden.md` · Phase-0 findings: `docs/api-notes.md`

## ✅ DONE

- [x] 1. Fork + clone [me] — forked olgasafonova/tilbudstrolden-mcp → DonBarbaG/madtrolden-mcp, upstream remote set.
- [x] 2. Baseline green [me] — `npm install && npm test` → 380/380 passing, Node 22.
- [x] 3. Probe Tjek API live [me] — /offers/search + /dealers match RawOffer; **/stores supports r_lat/r_lng/r_radius + dealer_id** (better than spec assumed). (docs/api-notes.md)
- [x] 4. Probe DAWA [me] — /adresser + /autocomplete work, no key; x=lng, y=lat. (docs/api-notes.md)
- [x] 5. Probe Frida [me] — dataset is on DTU Data/Figshare, DOI 10.11583/DTU.32312844, **CC BY 4.0**, direct xlsx download. mcp-handler v2.1.0 confirmed current name. (docs/api-notes.md)

## ESTIMATE (law-adjusted, measured — refreshed every session)

First session, no own velocity history yet. Phase 0 took ~0.5h wall. Remaining 29 items ≈ heavily ⏾ (all [me] except 27, 31): ratio vs Phase-0 pace suggests ~10–14 focused Claude-hours raw → **×1.7 Hofstadter ≈ 17–24 h Claude-work, of which ~95% is ⏾ night-able. Ludwig-hours: ~0.5–1 h** (Vercel login/env approval if CLI unauthed, trying the connector from his Claude, key handout to family). Refresh after Phase 1 ships.

## PHASE 1 — Remote + auth + cache

- [x] 6. Next.js scaffold [me] ⏾ — minimal App Router project, no UI framework; keep vitest + biome working; stdio entrypoint stays (`npm run dev:stdio`).
- [x] 7. Port `src/` → `lib/` [me] ⏾ — move all base logic untouched, fix imports, 380 tests still green.
- [x] 8. `/api/mcp` via mcp-handler [me] ⏾ — Streamable HTTP, all existing tools registered.
- [x] 9. Auth [me] ⏾ — `ACCESS_KEYS` name:key pairs, Bearer + path-key fallback `/api/mcp/<key>`, `crypto.timingSafeEqual`, uniform 401, loud boot failure on malformed env. `npm run genkey <name>` script.
- [x] 10. Rate limiting [me] ⏾ — in-memory token bucket ~60/min per key + ~300/min global, 429 + Retry-After.
- [x] 11. Deals cache [me] ⏾ — shared Map, offers TTL 6h, dealers 24h, stores 24h; RAM only.
- [x] 12. `whoami` tool [me] ⏾ — account name, cached-profile exists?, cache age.
- [x] 13. Landing page `/` [me] ⏾ — one boring static page, zero data.
- [x] 14. Deploy to Vercel [both] — region arn1/fra1, env vars set. May need Ludwig if `vercel` CLI unauthed.
- [x] 15. Phase-1 acceptance [both] ~90% — verified vs deployed https://madtrolden-mcp.vercel.app with curl-as-MCP-client: live hakket-oksekød deals, wrong key → uniform 401, dup search cache-hit (log-proven in prod-mode locally, same build). Remaining 10%: Ludwig connecting from his own Claude app.

## PHASE 2 — Profiles (client-held state)

- [x] 16. Profile schema + zod [me] ⏾ — DataStore schema as zod, extended fields (§6) validated.
- [x] 17. `import_profile` / `export_profile` [me] ⏾ — RAM cache `Map<account,{profile,updatedAt}>` TTL 24h; tool descriptions teach client AIs the durability story.
- [x] 18. All tools read cached profile [me] ⏾ — replace `~/.tilbudstrolden.json` file store; grep-proof: no fs writes outside /tmp.
- [x] 19. Phase-2 acceptance [me] ⏾ — import → plan → export round-trip test; cold-start + re-import identical behavior.

## PHASE 3 — Budget + nutrition

- [ ] 20. `data/baseline-prices.json` [me] ⏾ — ~150 danske stapler, conservative 2026 discount estimates, `"source": "estimates, user-editable"`.
- [ ] 21. `npm run build:nutrition` + `data/nutrition.json` [me] ⏾ — Frida xlsx → ~200–300 ingredients, kcal/protein/fat/carbs per 100g, CC BY 4.0 attribution, JSON committed.
- [ ] 22. `plan_week` solver [me] ⏾ — hard budget cap, kcal ±10%, greedy seed → local search, deterministic; infeasible → cheapest plan + gap + relax suggestions.
- [ ] 23. Phase-3 acceptance [me] ⏾ — unit tests: cap-binding, infeasible, no-kcal-target; "2 pers, 500 kr, 2000 kcal, veg, dinners" scenario.

## PHASE 4 — Meals + meal prep

- [ ] 24. `data/breakfast-lunch.json` [me] ⏾ — ~10 + ~10 danske billige templates; `mealType`/`batchable`/`keepsDays` fields, annotate the 32 dinners.
- [ ] 25. Meal-prep mode [me] ⏾ — ≤2 cook days, portions scale, leftovers scheduled onto the calendar (never vanish).
- [ ] 26. Phase-4 acceptance [me] ⏾ — `meal_prep=true, meals=[lunch,dinner]` → every cooked portion appears on some day.

## PHASE 5 — Location

- [ ] 27. DAWA geocoding + `find_stores_near` [me] ⏾ — address/latlng → branches within radius, haversine distances.
- [ ] 28. Distance-aware planning [me] ⏾ — chains with a branch in radius rank higher; shopping list shows nearest branch + km; regional-flyer caveat flagged.
- [ ] 29. Phase-5 acceptance [me] ⏾ — København address → sane branches/distances end-to-end on deployed URL.

## PHASE 6 — Polish + ship

- [ ] 30. ONBOARDING.md [me] ⏾ — for non-technical family: claude.ai connector, Desktop, Claude Code one-liner, first prompts, profile-saving habit.
- [ ] 31. README rewrite [me] ⏾ — architecture, env vars, deploy, credits (tilbudstrolden MIT, Tjek, Frida/DTU CC BY, DAWA, OSM).
- [ ] 32. CI [me] ⏾ — GitHub Actions: lint, typecheck, tests.
- [ ] 33. Security pass §9 [me] ⏾ — full checklist incl. git-history secret scan, npm audit, 429 test, outbound-host audit.
- [ ] 34. Keys + family rollout [you] — generate per-person keys into Vercel env, hand out, tag v1.0.0 after Ludwig's own end-to-end run.

## INBOX — unsorted brain-dumps

_(empty)_

## Deep references (linked, not archived)

- `docs/api-notes.md` — Phase 0 live-probe findings.
- `../claude-code-prompt-madtrolden.md` — the full build spec.
