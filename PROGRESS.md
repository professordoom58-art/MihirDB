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

## Arc carousel (2026-11-23)

- `lib/layout.ts`: `ARC` config (radius × vh, `minSpacing`, `stepDeg`, `scales`, `dimPerStep`, `rotateYPerStep`, `visibleSide`, `caseWidth`, `tiltDeg`). `itemTransform(o)` puts each case on the circle (x = R·sinθ, y = R·(1−cosθ), rotateZ = θ) from the same fractional `pos` as before, so drag/momentum/snap/haptics/sweep are unchanged. Drag mapping uses `d1 = R·sin(step)`.
- The whole arc tilts ±`tiltDeg` around the wheel centre (`.arc` wrapper, driven by the glare tilt/mouse value). 7 items mounted (active ±3). Reflection only under the top case.
- The literal spec (R = 1.6·vh, 12°) puts the first neighbour off-screen on a 390px phone, so the default is 0.78·vh with `minSpacing` 0.62 × case width: 1 neighbour per side on phone (clipped), 2 per side on wider screens.

## Full catalog import + Manrope (2026-11-23)

- Font: Manrope only, bundled from `@fontsource-variable/manrope` (Google Fonts files) via `src/fonts.css` with `font-display: block`; woff2 is precached by the SW. `sans-serif` remains only as the glyph-fallback for characters Manrope lacks.
- `scripts/import-old-catalog.ts` (`npm run import:old`): 179/179 imported (128 movies / 27 TV / 24 collections, 103 films inside collections), 0 failures. Values come from executing the old .ts data files; `originalOrder` + titles come from the "// N. Title" comments, cross-checked per entry. Cache in `scripts/.cache` (gitignored).
- Sort: rating desc → originalOrder asc → (app-added entries first, newest first).
- `lib/seed.ts` `mergeSeed()` (Settings → Re-import seed): match by kind+tmdbId / collection id; keeps my rating if edited in-app (updatedAt > addedAt), keeps reviews, keeps app-added movies. `lib/reviews.ts`: old-site review import + console snippet; a review's mihirScore wins.
- Data note: favoriteMovieIds for Fast & Furious is [9615] = *Tokyo Drift* on TMDB (Fast Five is 51497). Kept as written.
- No OMDb key yet → critic scores are empty (not faked).

## Wordmark + app icon (2026-11-23)

- "MihirDB" wordmark in the top bar (`TopBar.tsx`, `.wordmark` in ui.css): the ONE exception to Manrope-only. Stack: Helvetica Neue → Helvetica → TeX Gyre Heros (bundled, `src/assets/fonts`, Basic-Latin woff2 subset; no Light, so "DB" is 400 where it's used) → Arial. Tap = `goTo(0)`. Fades with the chrome via `room`.
- App icon: single source `assets/icon-source.png` (the user's 1024² artwork). `npm run icons` regenerates the iOS AppIcon + splash (via @capacitor/assets) and all PWA icons/favicon from it.

## Depth + loop verification (2026-11-23)

- **Spacing measured and corrected.** At rest the neighbour's *projected* box overlapped the centre case by only 9.0% with `minSpacing: 0.86` (below the 10–15% target). Changed to **0.825**; now 12.0% at 390×844, 12.2% at 430×932, 12.0% at 375×667, 12.6% at 1024×768. `minSpacing` is always the binding term for the wheel radius, so the ratio holds across sizes.
- **Captures** (390×844, headless Chromium, touch via CDP, `captures/` is gitignored): `slow-swipe.mp4`, `fast-flick.mp4` + `fast-flick-slowmo.mp4` (4×), `loop-1-to-179.mp4`, `loop-179-to-1.mp4`, plus stills `rest.png`, `halfway.png`, `before-half.png`, `after-half.png`, and the raw numbers in `results.json`.
- **Halfway (pos 0.49997):** slots 0 and 1 both z-index 9500, same width (235.3 px) and same dim (0.275). 3 px either side swaps to 9486/9514. In the still the two cases meet on a clean edge; nothing slices through.
- **Flick:** 1/179 → 5/179 in ~0.4 s, crossing several cases, then settles on an integer. The caption *text* jumps 1→5 (React batches the active-index updates at that speed); the cases themselves move continuously.
- **Loop 1 → 179 → 1:** correct both ways. 7 cases at rest, 8 (or up to 11 on a multi-item flick) while moving because `AnimatePresence` keeps the exiting cases mounted for their 0.3 s exit. No duplicate indices in any sampled frame.
- **Backdrop at the boundary:** 0.6 s crossfade, no blank frame (combined scene opacity never < 0.9), per-frame parallax step ≤ 0.87 px. The incoming scene begins ~21 px offset from the outgoing one; the crossfade hides the hand-off.
- Data note: 5 entries carry `myRating: 11` (Ra.One, Aarya 2, Don, Don 2, Akame ga Kill!). Kept as imported; they sort first and the UI renders "11".

## Releases + built-in catalog/key (2026-11-23)

- **TMDB key is hard-coded** in `src/lib/config.ts` (`BUILT_IN_TMDB_KEY`), with `.env` / repo-secret overrides still winning. Verified by building with `.env` renamed away: the key is in `dist/assets/index-*.js` and a production preview successfully searched TMDB ("The Matrix", 5 results), so no secret or `.env` is needed. Key rotation = edit the constant (or set `VITE_TMDB_API_KEY`).
- **Catalog is bundled**: `src/data/seed.json` (179 entries) is already imported by `ensureSeeded()` before the first paint. Fresh production build + empty browser profile → `1/179` (Ra.One) on first load with no import. `npm run import:old` is only for refreshing the seed.
- **Workflow publishes the IPA to Releases** (`contents: write`): tag `v*` → normal release `Shelf v1.2.3` with generated notes; manual `release` → pre-release `build-<run>`; manual `live` → pre-release `live-<run>`; `target_commitish` = the built SHA. The run artifact (`Shelf-<mode>-<run>`) is still uploaded. Uses `softprops/action-gh-release@v3`; release-details shell tested for all three cases.
- README: setup is now `npm install && npm run dev` (no `.env`, no import), the repo-secret step is optional, and "Install on iPhone" downloads `Shelf.ipa` from **Releases**. Also removed a stray UTF-16 `# MihirDB` tail that made README read as a binary file.

## Performance pass (2026-11-23)

Reported: very laggy in LiveContainer on an iPhone 13, and it sometimes went black and reset to `1/179`.

- **Freeze cause found**: `lib/sync.ts` cached each missing poster with its own `db.movies.update`, and the live shelf query (`useLive(() => db.movies.toArray())`) re-read *every* record, blobs included, after each write — ~180 full re-reads during the first sync. Now posters download 2 at a time and flush into IndexedDB in batches of 12 (`WRITE_BATCH`), using `downloadPoster()` so bytes are fetched outside the write. That stall is the likely black/relaunch trigger in a WebView with a memory cap.
- **Reset cause**: nothing remembered the position, so a WebView reload started at entry 1. `onSettle` now writes `shelf.activeId`, and the first data load restores it (verified: 3/179 → reload → 3/179).
- **Per-frame cost removed** (all verified in a production preview, 390×844):
  - `zIndex` quantised to 0.25 steps (`10000 - round(d*4)`) — was 0.001 steps, i.e. a compositor layer re-order every frame.
  - Depth blur stepped (none / 0.7px / `blurAt2`) instead of continuous — animating `filter` re-rasterises the case each frame.
  - Floor reflection rendered only for the top case and its immediate neighbours; it was mounted 7× and is invisible past |offset| 0.625.
  - Cases beyond 2.25 steps get `visibility: hidden` (they were already opacity 0).
  - Backdrop tint is a plain 15% colour instead of `mix-blend-mode: soft-light` (no full-screen blend per frame); backdrops are `w780` (was `w1280`, ¼ the decoded memory); grain overscan 50% → 10%; backdrop blur 13px → 10px.
  - `.case__highlight` no longer uses `mix-blend-mode: screen`.
  - `blobUrl()` object URLs are LRU-capped at 32 instead of one per cached poster for the session.
- **Adaptive lite mode** (`lib/perf.ts`, `useAutoPerf(pos)`): samples `requestAnimationFrame` deltas while `pos` is moving, judges the median of 50 frames, and adds `.app.perf-lite` if it exceeds 26 ms (~38fps), persisted in `sessionStorage` for that session only. `perf-lite` (in `stage.css`) stops Ken Burns and the grain animation, drops the remaining depth blur and both blend overlays. Screenshot at rest is indistinguishable; capable devices never enter it.

## Crash pass 2 (iPhone 13 / LiveContainer: black screen after 5–7 movies → back to 1/179)

Diagnosis (Chrome, 390×844 @3x, production build): no JS/DOM leak (heap ~7MB, nodes flat over 30 moves). The WebView was being killed for graphics memory: ~33 composited layers, est. ~217MB of surfaces mid-crossfade, mostly the backdrop.
- **Backdrop scene = 2 layers** (was ~10): the still is drawn into a ~64px `<canvas>` (cover-cropped, two down/up passes) and stretched: a GPU-upscaled tiny canvas *is* the blur, with no `filter`. Parallax on `transform`, Ken Burns on the separate `scale`/`translate` properties of the same element. All six grade overlays are stacked backgrounds on one static element. Crossfade animates those two elements (no group-opacity wrapper). Source image is `w300`.
- **Grain**: static, baked into the vignette; the animated grain element is desktop-only (`hover:hover and pointer:fine`). Dropped `will-change` from glare, highlight, reflection, backdrop dim.
- Estimated layers now 17 / ~84MB in Chrome emulation, less on a phone (no animated grain; the arc container paints nothing).
- **Exit pile-up**: AnimatePresence kept every case that scrolled out of the 7-case window alive for its exit animation, so up to 2× cases/posters/layers mid-flick. Exits now animate only when a rating-filter change removes cases (`animateExits`, `usePresence` in CarouselItem, released in a *passive* effect: framer ignores `safeToRemove` from a layout effect, which leaked cases). Captions likewise: one at a time (8 were stacking mid-flick). Soak: 24 fast flicks across 110 movies → items 7, imgs 10, nodes 172 constant.
- **One decode per poster**: `displaySrc()` pins the URL a movie is first shown with for the session (case + reflection share it; caching mid-session no longer swaps src = re-decodes 3.6MB).
- **Recovery**: position is saved as each case reaches the top (throttled 250ms), not only at rest, so a kill mid-flick resumes there. `guardAgainstCrashes()` (main.tsx) writes a heartbeat while visible and clears it on hide; a fresh heartbeat at launch = the WebView was killed → persistent lite mode (`localStorage shelf.safeMode`) + crash count, shown in Settings with "Turn off". Verified: flick to 8/179 → simulated kill → relaunch at 8/179 in lite mode; clean reload not counted.
- Not verifiable here: real iOS jetsam limits. If it still dies, Settings will say so (crash count), and the next launch is already in lite mode.

## Backdrop quality (after crash pass 2)

The 64px stretched canvas looked mosaic/grainy and the image edge showed on fast flicks. Now:
- `w780` still drawn cover-cropped into a **half-resolution** canvas (`RES 0.5`, `OVERSCAN 1.2`), then blurred on its pixels with 3 box passes ≈ Gaussian (`lib/blur.ts`, `BLUR_CSS_PX 12`, brightness 0.9 / saturate 1.05), run in a **Web Worker** (`blur.worker.ts`, buffer transferred) so a no-JIT WebView doesn't stall. Falls back to main thread / cheap down-up passes if the worker or CORS read fails. ~0.4MB per scene, no CSS filter. Needs CORS-clean images (`corsUrl`).
- Parallax bounded with `tanh(p - index)` (the scene only switches after settling, so a fast flick drifted past the overscan); overscan 10% per side. Verified: edge never on screen during fast flicks; no main-thread task > 50ms across 8 scene changes.
- Static grain alpha 0.07 → 0.04.

## Cleanup + drag-dismiss fix (2026-11-23)

- **Empty slot after drag-close**: the lifted shelf case was hidden with `visibility: hidden ? 'hidden' : itemVisibility` (string ↔ motion value swap, which framer doesn't re-write until the value changes, plus WebKit's flaky repaint of `visibility` on 3D/backface-hidden layers). Now hidden via the item's OPACITY motion value with a `lifted` motion value set in a layout effect (restored in the same commit the hero unmounts). DetailView is an explicit state machine (`open | dragging | closing | closed`, documented in the file): grab mid-close freezes in place and the finger takes over; a touch without dragging resumes the close; only `closing → closed` happens in an animation callback. Caption/top bar return over the last 40% of the flight. Verified per-frame (~4,400 frames): slot never empty, never doubled, incl. 10× rapid open/drag-close.
- **Floor line**: the floor gradient in the grade started at full strength with a 2px highlight. Now an eased ramp from transparent over ~70px. Contact shadow is a soft ~30% ellipse. (No backdrop-filter strip: no edge left to soften, and backdrop-filter costs iOS graphics memory.)
- Removed: tilt glare (`lib/tilt.ts`), the CD jewel case (DVD keep case is the only style; `CaseStyle` / style props gone), old-catalog importer (`Importer.tsx`, `lib/importer.ts`; `similarity()` moved to `lib/similarity.ts`), old-reviews import (`lib/reviews.ts`), "Re-import seed". `npm run import:old` (dev script) still exists.
- Settings: Shelf (Lite mode switch, always visible; `setLiteMode()` applies instantly, persists, overrides auto-detect; a crash still forces it on) and Backup (Export backup / Import backup).
- Add/edit sheet: `Sheet variant="glass"` (Liquid Glass styles in ui.css). Gotcha: list `-webkit-backdrop-filter` BEFORE `backdrop-filter`; the other order makes the minifier drop the standard property (desktop then shows no blur).
- Gotcha: the Bash and Write tools turn backslash-u escapes in written content into raw characters. Use `\p{M}` or the Edit tool for regexes that need them.

## Detail hero moved out of the card (2026-11-23)

- **Clipping on drag-close**: the flying case was a child of `.detail__card` (`overflow: hidden` + drag transform), so when the dragged card sat lower than the slot the case was cut by the card's top edge. Now the hero renders via `createPortal` into `#hero-layer` (App, inside `.app`, z 26: above the detail view (25), below sheets (30)): fixed, full-screen, overflow visible, no transform/filter/contain/will-change. Its ancestors are only `.app`/`#root`/`body`/`html`, which clip at the screen edges only. The card keeps an empty `.detail__slot` placeholder; `measure()` reads it (mount, scroll, resize) into card-space motion values, and the card's drag (y + scale about screen centre) is applied to the hero mathematically (`heroScreenX/Y/Scale`), so it moves with the card. Poster scrolled off-screen → hero opacity 0; closing from there fades it in AT the slot. Delete `Confirm` is portalled to `.app` so it sits above the hero. Scrollbar hidden on `.detail__scroll`.
- Two more close bugs found from frame captures: (1) our own `history.back()`'s popstate arrived after a finger grabbed the card mid-close and re-closed it → `ownBack` flag; (2) releasing a drag fires a click on the scroll background ("tap to close") → ignored for 350ms after a drag.
- Verified with CDP screencast frames (~50ms apart) for drag-dismiss, fast flick, cancelled drag, grab-mid-close; per-frame audit 1,903 frames: never empty/doubled; hand-off rect error ≤ 0.02px.

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

1. Commit `src/data/seed.json` (generated). Optionally add `VITE_OMDB_API_KEY` and re-run `npm run import:old` for critic scores.
2. Create a GitHub repo, push, add the `TMDB_API_KEY` secret, run **iOS IPA** (release), sideload, and check on device: haptics, tilt permission, safe areas, 60fps.
