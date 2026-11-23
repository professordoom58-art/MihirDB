# Shelf

A personal movie catalog for iPhone: a PS5-style cover-flow of CD jewel cases, sorted by my own rating. It's built with Vite, React and TypeScript, and wrapped for iOS with Capacitor. The IPA is built in GitHub Actions, so **no Mac or Xcode is needed**.

> **About the API keys:** this is a personal app, so the TMDB/OMDb keys (from `.env` or Settings) are bundled into the client and stored on the device. Don't publish a build or share it.

---

## 1. Setup (once)

```bash
npm install
cp .env.example .env      # then paste your keys
```

- **TMDB key:** https://www.themoviedb.org/settings/api. Either the v3 "API Key" or the v4 "Read Access Token" works.
- **OMDb key:** https://www.omdbapi.com/apikey.aspx (free tier: 1,000 lookups a day).

You can also skip `.env` and paste the keys into the app: **search icon → gear → API keys**.

### If TMDB "can't be reached" (Jio / some Indian ISPs)

Some ISPs block `api.themoviedb.org` at the DNS level. Poster images are not affected. Shelf handles this in layers:

| Where you run it | What happens |
|---|---|
| `npm run dev` (laptop, phone over Wi-Fi, live-reload IPA) | Requests go through the dev server, which resolves TMDB via public DNS (1.1.1.1). **Works out of the box.** |
| Release IPA / home-screen PWA | Search automatically falls back to **OMDb** (not blocked), so adding movies still works. For full TMDB results, either set your phone's DNS to 1.1.1.1 (the free "1.1.1.1" app), or deploy `proxy/tmdb-worker.js` to Cloudflare Workers (free) and put its URL in `VITE_TMDB_BASE` or Settings → TMDB proxy URL. |

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
- **Search icon (top-left):** find a movie on your shelf, or filter by a rating range. The **gear** opens Settings: CD/DVD case style, tilt glare, backup, import, API keys.
- **Offline:** every poster is saved on the device, so the shelf works without a connection. Critic scores that failed (offline or the OMDb limit) are retried automatically.

### Backups (important for sideloaded apps)

Settings → **Export JSON** opens the share sheet. Save it to Files or iCloud Drive. **Import JSON** merges a backup back in (the newer edit wins). Settings shows when you last backed up.

### Importing the old catalog

Settings → **Import old catalog…** gives you three ways in:

1. **URL:** paste your old site's address and tap Fetch (works while running `npm run dev`; the dev server fetches the page for you).
2. **File:** a JSON/CSV export, a saved web page (.html), or a .txt list.
3. **Paste:** e.g. `The Matrix (1999) - 9/10 - great`.

The importer detects titles, years, ratings and reviews, and converts /5 or /100 scales to /10. It matches everything on TMDB and shows you **only the uncertain matches** to confirm (with posters), then saves.

---

## 4. Build the iPhone app (no Mac)

The `ios/` folder is committed. GitHub's macOS runners do the Xcode part.

### One-time

1. Create a **private** GitHub repo and push this project:
   ```bash
   git remote add origin https://github.com/<you>/shelf.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Secrets and variables → Actions** and add `VITE_TMDB_KEY` and `VITE_OMDB_KEY`. Optionally add `VITE_TMDB_BASE`. You can skip this and paste the keys in the app's Settings instead.

### Each build

**Actions → iOS IPA → Run workflow**, then pick:
- `release`: bundled app, works offline.
- `live` + `live_url` = `http://<laptop-ip>:5173`: a dev build that loads your laptop (see §2).

Pushing a tag like `v1.0.0` also builds a release.

When it finishes (~5–10 min), download the **Shelf-…** artifact from the run page and unzip it to get `Shelf.ipa`.

## 5. Install on iPhone

1. Install **Sideloadly** on Windows (https://sideloadly.io) and **iTunes from apple.com** (not the Microsoft Store version), which provides the drivers.
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
    JewelCase.tsx         CD / DVD case + glare sweep + tilt/mouse highlight
    Backdrop.tsx          blurred, crossfading background
    DetailView.tsx        lift-and-open detail, swipe down to close
    MovieEditor.tsx       add (TMDB search) / edit, rating slider, duplicate check
    SearchPanel.tsx       find + rating filter, gear → Settings
    Settings.tsx          case style, tilt, backup, import, keys
    Importer.tsx          old-catalog importer (parse → match → review → save)
  lib/
    db.ts                 Dexie (IndexedDB) schema
    tmdb.ts, omdb.ts      API clients;  catalog.ts = TMDB with an OMDb fallback
    posters.ts, sync.ts   offline poster cache, background score retry
    importer.ts           catalog parsing + fuzzy title matching
    backup.ts             export/import JSON (share sheet on iOS)
    haptics.ts, tilt.ts   Capacitor haptics, DeviceOrientation glare
capacitor.config.ts       app id/name; CAP_LIVE=1 → live-reload server.url
.github/workflows/ios.yml unsigned IPA on macOS
proxy/tmdb-worker.js      optional TMDB proxy for blocked networks
```
