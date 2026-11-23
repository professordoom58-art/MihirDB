# Shelf: progress log

Spec: `movie-shelf-prompt.md`. User guide: `README.md`.

## Status (2026-11-23)

| Phase | State |
|---|---|
| 1. Scaffold + carousel | Done |
| 2. Add-movie flow + storage | Done (tested with mocked APIs; needs real keys in `.env` for a live check) |
| 3. Phone polish | Done in browser; haptics/tilt/safe areas need an on-device check |
| 4. Import old catalog | Importer built (URL / file / paste). **Not yet run on the real old site** (its link was never provided) |
| 5. Capacitor iOS + IPA workflow | Done locally (`ios/` generated, SPM, no CocoaPods). **Workflow not yet run on GitHub** (no remote yet) |

## Fix pass (2026-11-23, `shelf-fix-pass.md`)

- Keys are build-time only: `VITE_TMDB_API_KEY` or `VITE_TMDB_READ_TOKEN` (+ optional `VITE_OMDB_KEY`). The Settings key UI is gone. CI maps `secrets.TMDB_API_KEY` to `VITE_TMDB_API_KEY`.
- TMDB host fallback (`lib/config.ts` `tmdbBases`, `lib/tmdb.ts`): `/api/tmdb` (Vite proxy / Vercel rewrite → api.tmdb.org) → api.themoviedb.org → api.tmdb.org, 6s each, the working one is remembered. **api.tmdb.org is not DNS-blocked on the user's ISP.**
- Entries now carry `kind`, `backdropPath`, `palette {dark,vivid,light}`, `tag`, `parts`. `src/data/seed.json` is loaded on first launch (`lib/seed.ts`, before first render); a sample-only DB counts as empty. **seed.json is still `[]`**: generate it with `npm run seed` once `.env` has the key (`scripts/build-seed.ts` clones the old repo; Node 24 runs the .ts directly). The old site stored reviews in browser localStorage, so the seed has no review text.
- Background (`components/Backdrop.tsx`, `stage.css`): 2 crossfading scenes max (600ms, 120ms settle), backdrop w1280 with Ken Burns drift and blur 13px, soft-light palette tint + dark wash, glow + spotlight + beam, floor sheen; fixed vignette + SVG grain; parallax = 10% of drag + tilt/mouse. Floor reflections are mirrored JewelCases in `Carousel.tsx`. Rating tint = `readableTint(vivid, dark)` ≥ 4.5:1.
- Palette quantiser (`lib/palette.ts`) is shared by the seed script (sharp, 24×36) and the app (canvas 48×72 with high-quality smoothing; a straight 24×36 canvas downscale lost the Dark Knight's orange).

## Key decisions / gotchas

- **Posters:** the TMDB image CDN only sends CORS headers when the request has an `Origin`. Display `<img>`s therefore load *without* `crossOrigin`. Canvas/blob reads use `corsUrl()` (`?cors=1`) for a separate cache entry. Mixing the two made every poster fail in Chrome after the first visit.
- **ISP DNS block:** `api.themoviedb.org` resolves to a Jio block address on the user's network. `vite.config.ts` proxies `/api/tmdb/*` to api.tmdb.org with a public-DNS lookup (1.1.1.1); see the host fallback above. `lib/catalog.ts` falls back to OMDb search/details when TMDB is unreachable. `proxy/tmdb-worker.js` is an optional Cloudflare proxy.
- **Carousel taps:** pointer capture retargets `pointerup` to the stage, so the tapped case is recorded at `pointerdown`. The detail overlay ignores background clicks for its first 450ms (the tap's synthetic click would otherwise close it immediately).
- **Glare sweep** fires on "visually settled" (`settlePending` in Carousel), keyed by movie id.
- **Keeping position across data changes:** App's layout effect keeps the active *movie id* centred when the list changes, then glides to `pendingFocus` (newly saved/edited movie).
- `crypto.randomUUID` is unavailable over plain http on the phone, hence `newId()`.
- Haptics are a no-op unless `Capacitor.isNativePlatform()`. The service worker registers only in production web builds (not in the native app).
- The live IPA gets ATS local-network exceptions added by the workflow only (PlistBuddy), never the release build.
- The user's editor auto-updates imports on file renames. If a write races with it, write via the scratchpad and `cp`.

## Verified (headless Chromium, 390×844, mocked TMDB/OMDb)

Empty state → load samples → posters (15/15 cached as blobs) → background score sync → tap to open detail (lift animation) → edit rating (re-sorts and glides) → delete with confirm → add via search (keyboard autofocus, duplicate warning) → title search and rating filter → importer (paste → /5 scale detected → match → review uncertain) → export/import JSON round-trip → offline posters with the CDN blocked. Touch via CDP: drag, flick, side tap, centre tap, swipe-down on detail and sheet.

## Next steps (need the user)

1. Put the TMDB key in `.env`, restart `npm run dev`, run `npm run seed`, and commit `src/data/seed.json`.
2. Create a GitHub repo, push, add the `TMDB_API_KEY` secret, run **iOS IPA** (release), sideload, and check on device: haptics, tilt permission, safe areas, 60fps.
