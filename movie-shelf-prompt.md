# Build "Shelf": a personal movie catalog iPhone app (no Mac, no Xcode)

You are building a personal movie catalog app for me. I'm on **Windows/Linux with an iPhone. I don't have a Mac or Xcode, and I don't have a paid Apple Developer account.** Every decision below has to work within those limits. Work in the phases listed at the end and stop for my review after each one.

## 0. My current site (reference only)

My existing catalog is here: **[PASTE CURRENT SITE LINK]**

- Open it and take note of the movies, my ratings and my reviews. Phase 4 imports that data.
- **Do not copy its layout.** I don't like how it looks. The new design is specified below.

---

## 1. Tech stack (do not change without asking me)

| Need | Choice | Why |
|---|---|---|
| UI | **Vite + React + TypeScript** | `npm run dev` previews it in my laptop browser |
| Styling/animation | Plain CSS (or CSS modules) + **Framer Motion** where needed | Smooth carousel, glare and transitions |
| Native wrapper | **Capacitor** (latest stable) | Turns the web app into a real iOS app without needing a Mac locally |
| On-device storage | **IndexedDB via Dexie** (works the same in browser and in the Capacitor iOS WebView) | Data stays on the phone, no backend |
| Movie data | **TMDB API** (search, poster, year, director, runtime, IMDb id) | Free API key |
| Critic ratings | **OMDb API** using the IMDb id from TMDB → IMDb rating, Rotten Tomatoes %, Metacritic | Free key, returns all three |
| IPA build | **GitHub Actions macOS runner**, unsigned `.ipa` as a build artifact | Apple's tools run in the cloud, so I don't need a Mac |
| Install on phone | **Sideloadly** (Windows) or **AltStore/SideStore** with my free Apple ID | Signs and installs the unsigned IPA |

API keys go in `.env` (`VITE_TMDB_KEY`, `VITE_OMDB_KEY`). Add `.env.example` and keep `.env` in `.gitignore`. This is a personal app, so bundling the keys into the client is acceptable, but put a comment in the README saying so.

---

## 2. Dev workflow: I must NOT have to rebuild the IPA to see changes

Set up all three of these and document them in the README:

1. **Laptop browser:** `npm run dev` runs the full app with real data and real APIs. Use mobile viewport defaults (390×844) and test it in Chrome DevTools device mode. Every feature has to work here.
2. **Live on my iPhone with no install:** `npm run dev -- --host` and I open `http://<laptop-ip>:5173` in Safari on the same Wi-Fi. Make the app a **PWA** (manifest, icons, `apple-mobile-web-app-capable`, standalone display) so I can also use "Add to Home Screen" and get a full-screen app-like version without any IPA.
3. **Installed app with live reload:** add a `capacitor.config.ts` switch driven by an env var (`CAP_LIVE=1`) that sets `server.url` to my laptop's dev server (`cleartext: true` for dev only). Then one installed "dev build" IPA loads my laptop's live code, and I only reinstall when native config changes. The production build must bundle the assets and must not point at the laptop.

Add npm scripts: `dev`, `build`, `preview`, `cap:sync`, plus a short "which mode do I use when" table in the README.

---

## 3. The look: PS5-style carousel, built for a phone

**Overall feel:** clean, dark, premium, no clutter. The posters are the UI. No visible navbars, borders, cards or badges on the main screen apart from what's listed here.

### Main screen: the shelf
- A **single horizontal cover-flow carousel**, centered vertically, with swipe and momentum and **snap to each item**.
- **The centered item** is large (~70% of screen width), flat and fully lit. **Neighbors** are smaller, rotated slightly in 3D (`rotateY` ±25–35°), pushed back and dimmed. About 1.5 neighbors show on each side.
- **Background:** a heavily blurred, darkened version of the active poster that crossfades smoothly as you scroll, like the PS5 home screen.
- **Below the centered item**, quiet small text: title, year and **my rating** (large, e.g. `9.5`). Nothing else.
- Top-right: a single minimal `+` button. Top-left: a small search/filter icon (search by title, optionally filter by rating range).
- **Order:** sorted by **my rating, highest first** (10 → down). Ties go to the most recently added. A newly saved movie animates into its correct position.
- **Haptic tick** on each snap (Capacitor Haptics; no-op in browser).
- Must hold **60fps on an iPhone**. Use `transform`/`opacity` only, virtualize if there are more than ~50 items, and lazy-load posters with blur-up placeholders.

### Posters look like CD jewel cases
- Each cover is rendered as a **CD jewel case**: square case, poster as the front insert (`object-fit: cover`, anchored toward the top so faces/titles survive the crop), a thin darker **hinge spine on the left edge**, a subtle clear-plastic edge/bevel and a soft drop shadow underneath.
- Add a setting toggle for **"DVD case" mode** (2:3 ratio, same styling) in case square crops look bad on some posters.

### The glare (important)
- When an item **snaps to center**, a **specular glare sweeps diagonally across the plastic** once (~700ms, soft white gradient, `mix-blend-mode: screen` or `overlay`).
- While it stays centered, a faint static highlight remains on the plastic.
- When you swipe to the next one, the glare plays **on the new item**, and the previous item's glare fades out.
- **Bonus:** on the phone, the glare position also **follows device tilt** (DeviceOrientation; iOS needs a permission prompt, so ask once with a nice in-app button, not on load). In the browser, follow the mouse instead.
- Respect `prefers-reduced-motion`: no sweep, static highlight only.

### Detail view
- Tap the centered case → it **lifts and opens** (scale up / flip) into a detail sheet: big poster, title, year, director, runtime, genres, **my rating**, **my review**, and the critic scores (IMDb ★, Rotten Tomatoes 🍅 %, Metacritic box) shown as small, tasteful chips. If a score is missing, hide it instead of showing "N/A".
- Edit and Delete buttons (delete needs a confirm). Swipe down to close.

### General UI
- iPhone safe areas (`env(safe-area-inset-*)`), no rubber-band glitches, no text selection on swipe, and no zoom on input focus (inputs ≥16px).
- One clean typeface (e.g. Inter or SF via `-apple-system`) and a restrained palette: near-black, white, one accent pulled from the active poster.

---

## 4. Adding a movie on the phone (must be fast)

1. Tap `+` → a bottom sheet with a search field (autofocus).
2. As I type, call **TMDB search** (debounced ~300ms) and show results as small poster thumbnails with title and year, so I can tell remakes apart.
3. Tap the right one → the app **automatically fetches**: poster (high-res TMDB image), year, director, runtime, genres, IMDb id → then **OMDb** for IMDb, Rotten Tomatoes and Metacritic scores.
4. I set **my rating** with a big, thumb-friendly slider or picker, **1–10 in 0.5 steps**, and write **my review** (multi-line, auto-growing).
5. Tap **Save** → the sheet closes, the carousel scrolls to the movie's sorted position and the glare plays on it.
- If the movie already exists, offer to edit the existing entry instead of duplicating it.
- If OMDb fails or is rate-limited, still save, then retry the scores later in the background.
- Cache the poster image locally (blob in IndexedDB) so the shelf works **offline** after first load.

---

## 5. Data and safety

- Data model: `id, tmdbId, imdbId, title, year, director, runtime, genres[], posterUrl, posterBlob, myRating, myReview, imdbRating, rtScore, metacritic, addedAt, updatedAt`.
- **Export/Import JSON** in a small settings screen (gear icon inside the search panel, not on the main shelf). This is my backup, because reinstalling a sideloaded app can wipe its data. Put a "last backup" date in settings.
- **Import from my old site** (Phase 4): write a one-time importer that takes the movies from **[PASTE CURRENT SITE LINK]** (scrape or a JSON/CSV I provide), matches each title to TMDB, shows me a review list of uncertain matches to confirm, then saves everything.

---

## 6. Building the IPA without a Mac

- `npx cap add ios` and commit the `ios/` folder.
- Create `.github/workflows/ios.yml` on `macos-latest`: install Node, `npm ci`, `npm run build`, `npx cap sync ios`, then `xcodebuild` archive for `iphoneos` with **`CODE_SIGNING_ALLOWED=NO`** (use the `.xcworkspace` if CocoaPods is used, otherwise the `.xcodeproj`). Then package `Payload/App.app` into **`Shelf.ipa`** and upload it as a workflow artifact. It runs on manual dispatch and on tags.
- Provide two workflow inputs: `live` (dev build that points to my laptop) and `release` (bundled).
- Set the app name "Shelf", bundle id `com.mihir.shelf`, a dark app icon (jewel-case motif) and a splash screen. Use `@capacitor/assets` to generate them.
- README section **"Install on iPhone"**: download the artifact → Sideloadly with my Apple ID → enable Developer Mode on the iPhone → trust the profile. Note that free-account signing expires after **7 days** and needs re-signing (AltStore/SideStore can auto-refresh), and that **re-signing keeps my data, but deleting the app loses it**, which is why export exists.

---

## 7. Phases (stop after each for my review)

1. **Scaffold + carousel with mock data:** Vite/React/TS, 15 hardcoded movies, the full cover-flow, jewel cases, glare sweep, blurred background. I review this in `npm run dev` before anything else. Spend the most effort on making this feel premium.
2. **Add-movie flow + storage:** TMDB search, OMDb scores, rating and review, Dexie persistence, rating sort, detail view, edit/delete.
3. **Phone polish:** PWA, safe areas, haptics, tilt glare, offline poster cache, export/import, performance pass.
4. **Import my existing catalog** from the old site.
5. **Capacitor iOS + GitHub Actions IPA + README install guide.**

At the end of each phase: list what was done, what's left, and exactly what I should run or tap to test it. Keep a `PROGRESS.md` updated so a new session can pick up where we left off.
