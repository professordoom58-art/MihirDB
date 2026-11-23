# Shelf

A personal movie catalog for iPhone: a PS5-style arc of DVD keep cases, sorted by my own rating. It's built with Vite, React and TypeScript, and wrapped for iOS with Capacitor. The IPA is built in GitHub Actions, so **no Mac or Xcode is needed**.

> **About the API key:** the TMDB key is hard-coded in `src/lib/config.ts`, so the app works with no `.env` file and no GitHub secret. It is compiled into the bundle — keep this repo private, and rotate the key if you ever publish it. A `.env` value or the `TMDB_API_KEY` secret still overrides the built-in key.

---

## 1. Setup (once)

```bash
npm install
npm run dev
```

- **TMDB key:** already built in (`src/lib/config.ts`); nothing to set up. To rotate it, edit that constant, or put `VITE_TMDB_API_KEY` (v3 key) / `VITE_TMDB_READ_TOKEN` (v4 token) in `.env` — the env value wins.
- **OMDb (optional, critic scores):** no key is built in yet. Add `VITE_OMDB_API_KEY` (or `VITE_OMDB_KEY`) to `.env` to unlock IMDb / Rotten Tomatoes / Metacritic scores.
- **Catalog:** the 179-entry catalog is already inside the app (`src/data/seed.json`) and loads itself on first launch. You do not need to import it by hand.

**The shelf doesn't need the API.** Every entry stores its poster/backdrop paths, palette, rating, review and tag, and images come from `image.tmdb.org` (no key). On first launch the bundled `seed.json` (your old catalog) is loaded automatically, so browsing works offline and without the API. The key is only used when you **add** a movie. If no key is configured, the add sheet shows "Search is offline — key missing"; that won't happen with the built-in key.

**Regenerating the catalog (optional).** `npm run import:old` clones the old repo to `../ilovemovies-old` (or `--repo <path>`) and *executes* its `favoriteMovies.ts`, `mihirRatings.ts` and `customGenres.ts` (Node's built-in TypeScript support, so values are exact). It fetches TMDB details for all 179 entries, plus every film inside the 24 collections, extracts poster palettes, and writes `src/data/seed.json`. Responses are cached in `scripts/.cache`, so re-runs take about a second (`--fresh` clears the cache). It prints a summary and lists anything that failed to resolve. You only need this to refresh the bundled catalog; the app does not run it.


### If TMDB "can't be reached" (Jio / some Indian ISPs)

Some ISPs block `api.themoviedb.org` at the DNS level. Images and `api.tmdb.org` are not affected. Every TMDB call tries these in order and remembers the one that works:

1. `/api/tmdb/*`: same-origin proxy (the Vite dev server; on Vercel, the rewrite in `vercel.json`), forwarding to `api.tmdb.org/3`
2. `https://api.themoviedb.org/3`
3. `https://api.tmdb.org/3`

If TMDB still can't be reached and an OMDb key is set, search falls back to OMDb.

---

## 2. Day-to-day: three ways to run it

| Mode | Command | Use it when |
|---|---|---|
| **Laptop browser** | `npm run dev` → http://localhost:5173. In Chrome DevTools, press Ctrl+Shift+M and pick an iPhone (390×844). | Building features. Everything works here. Drag with the mouse, use the wheel/trackpad, ← → keys, Enter to open, Esc to close. |
| **iPhone, no install** | `npm run dev:host`, then on the phone (same Wi-Fi) open `http://<laptop-ip>:5173` in Safari. Optional: Share → **Add to Home Screen** for a full-screen app. | Checking feel, touch and haptics-free behaviour on the real screen. Changes appear on save. |
| **Installed app, live reload** | Build a **live** IPA once (see §4, mode `live`), install it, then just run `npm run dev:host`. | Testing native bits (haptics, safe areas, the real app icon). You only reinstall when native config changes. |
| **Installed app, release** | Build a **release** IPA (§4). | The real thing. Bundled, works offline, no laptop needed. |

`<laptop-ip>`: run `ipconfig` and use the IPv4 address of your Wi-Fi adapter (e.g. `192.168.1.23`). If the phone can't connect, allow Node.js through Windows Firewall on private networks.

### Scripts

| Script | Does |
|---|---|
| `npm run dev` | Dev server with hot reload (and the TMDB proxy) |
| `npm run dev:host` | Same, reachable from your phone |
| `npm run build` | Type-check and production build into `dist/` (with service worker) |
| `npm run preview` | Serve the production build on :4173 (also on your Wi-Fi) |
| `npm run cap:sync` | Build, then copy the web app into the iOS project |
| `npm run cap:sync:live` | Point the iOS project at your laptop's dev server (live reload) |
| `npm run icons` | Regenerate the app icon/splash (`scripts/make-icons.mjs`) and iOS assets |

---

## 3. Using the app

- **Shelf:** swipe through, tap a side case to centre it, tap the centre case to open it. Sorted by your rating (ties → most recently added).
- **`+`:** search TMDB, pick the right film (posters and years tell remakes apart), set your rating (1–10, half steps) and review, then **Save**. The shelf glides to its spot and the glare plays on it.
- **Detail:** swipe down (or tap the chevron) to close. Edit and Delete live here.
- **Search icon (top-left):** find a movie on your shelf, or filter by a rating range. The **gear** opens Settings: lite mode, and backup (export / import).
- **Offline:** every poster is saved on the device, so the shelf works without a connection. Critic scores that failed (offline or the OMDb limit) are retried automatically.

### Backups (important for sideloaded apps)

Settings → **Export backup** opens the share sheet. Save it to Files or iCloud Drive. **Import backup** merges a backup file back in (the newer edit wins). Settings shows when you last backed up.

**Lite mode** (Settings) turns off the heaviest effects. It switches on automatically after the WebView runs out of memory, and the switch is always there to turn it on or off yourself.


---

## 4. Build the iPhone app (no Mac)

The `ios/` folder is committed. GitHub's macOS runners do the Xcode part.

### One-time

1. Create a **private** GitHub repo and push this project:
   ```bash
   git remote add origin https://github.com/<you>/shelf.git
   git push -u origin main
   ```
2. **Optional:** the TMDB key is already built in, so no secret is required. If you prefer to keep it out of the repo, add `TMDB_API_KEY` (and optionally `OMDB_API_KEY`) under **Settings → Secrets and variables → Actions → New repository secret**; the secret overrides the built-in key at build time.

### Each build

**Actions → iOS IPA → Run workflow**, then pick:
- `release`: bundled app, works offline.
- `live` + `live_url` = `http://<laptop-ip>:5173`: a dev build that loads your laptop (see §2).

Pushing a tag like `v1.0.0` also builds a release.

Every successful build is published to **Releases**, with `Shelf.ipa` attached (the workflow declares `contents: write` for this):

| Trigger | Release | Marked latest |
|---|---|---|
| Tag push, e.g. `v1.0.0` | `Shelf v1.0.0` (normal release, generated notes) | Yes |
| Manual run, `release` | `Shelf build <run>` — pre-release, tag `build-<run>` | No |
| Manual run, `live` | `Shelf live build <run>` — pre-release, tag `live-<run>` | No |

Open the repo's **Releases** page and download `Shelf.ipa` (~5–10 min per build). The **Shelf-\<mode\>-\<run\>** artifact on the run page still works too; both contain the same file.

## 5. Install on iPhone

1. Download `Shelf.ipa` from **Releases** (or the run's artifact). Install **Sideloadly** on Windows (https://sideloadly.io) and **iTunes from apple.com** (not the Microsoft Store version), which provides the drivers.
2. Plug the iPhone in with a cable and tap **Trust** on the phone.
3. Drag `Shelf.ipa` into Sideloadly, enter your Apple ID, and click **Start**. A free Apple ID works; use an app-specific password if you have 2FA.
4. On the iPhone, go to **Settings → Privacy & Security → Developer Mode**, turn it on and restart (iOS 16+; the toggle appears after the first sideload).
5. Go to **Settings → General → VPN & Device Management**, tap your Apple ID and choose **Trust**.
6. Open Shelf.

**Things to know about free-account signing:**
- The app **expires after 7 days**. Re-sign it by running Sideloadly again with the same IPA. **AltStore / SideStore** can auto-refresh it in the background instead.
- **Re-signing or updating keeps your data. Deleting the app loses it.** That's what Export JSON is for.
- A free Apple ID allows 3 sideloaded apps at a time.

---

## Project map

```
src/
  App.tsx                 shelf state, sorting/filter, wiring
  components/
    Carousel.tsx          cover-flow: one motion value drives every case (60fps, virtualised)
    JewelCase.tsx         DVD keep case + glare sweep + mouse highlight
    Backdrop.tsx          blurred, crossfading background
    DetailView.tsx        lift-and-open detail, swipe down to close
    MovieEditor.tsx       add (TMDB search) / edit, rating slider, duplicate check
    SearchPanel.tsx       find + rating filter, gear → Settings
    Settings.tsx          lite mode, backup (export / import)
  lib/
    db.ts                 Dexie (IndexedDB) schema
    config.ts             built-in TMDB key + TMDB host fallback
    seed.ts               first-launch bundled catalog + seed merge
    tmdb.ts, omdb.ts      API clients;  catalog.ts = TMDB with an OMDb fallback
    posters.ts, sync.ts   offline poster cache, background score retry
    similarity.ts         fuzzy title matching (Find on my shelf)
    backup.ts             export/import JSON (share sheet on iOS)
    haptics.ts            Capacitor haptics
capacitor.config.ts       app id/name; CAP_LIVE=1 → live-reload server.url
.github/workflows/ios.yml unsigned IPA on macOS
proxy/tmdb-worker.js      optional TMDB proxy for blocked networks
```
