# The Games List

A personal game completion tracker — a React app displaying a grid of beaten games with cover art, organized alphabetically. Features a spotlight scroll effect, achievement tracking, and a dev UI for managing the collection.

**Live site:** [arcensurf.github.io/game-list](https://arcensurf.github.io/game-list/)

## Setup

Node.js 20+ and npm.

```bash
git clone https://github.com/arcensurf/game-list.git
cd game-list
npm install
npm run pull-data     # covers + derived data from R2 (needs the R2 keys below)
```

`npm run pull-data` mirrors the R2 bucket into `public/data/` and `public/covers/`. Re-run it whenever the nightly workflow has moved ahead of your checkout — nothing warns you that local data is stale, the app just quietly shows older counts.

### Environment Variables

Create `.env.local` in the project root:

```env
SGDB_API_KEY=your_steamgriddb_api_key
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret
```

| Variable | Purpose |
|----------|---------|
| `SGDB_API_KEY` | [SteamGridDB](https://www.steamgriddb.com/) key, for browsing and fetching cover art |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Read/write access to the data bucket — needed by `pull-data`, `sync-data`, and the Publish button |

### GitHub Actions Secrets

The nightly achievement sync runs in CI, so its credentials live in **repo secrets** (Settings → Secrets and variables → Actions), not in `.env.local`:

| Secret | Purpose | How to get it |
|--------|---------|---------------|
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Read/write the data bucket | Cloudflare dashboard → R2 → Manage API tokens |
| `STEAM_API_KEY` | Steam Web API key | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) |
| `STEAM_USER_ID` | Your Steam64 ID | [steamid.io](https://steamid.io) |
| `PSN_NPSSO_TOKEN` | PSN auth token (~60-day lifetime) | `npm run psn-get-npsso-token` |
| `XBOX_REFRESH_TOKEN` | Xbox Live refresh token (auto-rotates) | `npm run xbox-get-refresh-token` |
| `RA_API_KEY` / `RA_USERNAME` | RetroAchievements Web API | Account control panel on [retroachievements.org](https://retroachievements.org) |
| `FFXIV_LODESTONE_ID` | Lodestone character ID for the FFXIV scrape | Your character's Lodestone URL |

When the PSN token expires the workflow opens a GitHub issue with renewal instructions. Xbox tokens auto-rotate as long as the workflow runs at least once every 90 days; if one is invalidated, that raises an issue too.

## Running

```bash
npm run dev      # Vite at http://localhost:5173/game-list/, with the dev UI
npm run build    # tsc -b, then Vite build into dist/
npm run lint
```

## Scripts

```bash
npm run pull-data                # Mirror the R2 bucket down to public/
npm run sync-data                # Push public/ changes up to R2 (--dry-run, --prune)
npm run convert-covers           # Convert any covers in the bucket that aren't WebP
npm run deploy-worker            # Deploy worker/index.js to Cloudflare
npm run fetch-covers             # Download cover art from SteamGridDB
npm run fetch-achievements       # Sync achievements from Steam, PSN, Xbox, RetroAchievements
npm run psn-get-npsso-token      # Interactive PSN auth helper
npm run xbox-get-refresh-token   # Interactive Xbox auth helper
```

The achievement sync normally runs on the daily cron (`fetch-achievements.yml`); you only need it locally for debugging. Manual runs take a **`force_refresh`** checkbox, which rebuilds every per-game shard instead of skipping games whose counts haven't moved — for when shards are stale in a way the normal checks can't see, such as a shard format change.

The token helpers save to `~/.game-list/` and copy the token to your clipboard for pasting into repo secrets.

## Where the data lives

Two stores, split by who writes the file. **Git (`main`)** owns the hand-authored source — `public/data/games.json` and everything under `public/data/overrides/`. **R2** owns everything else: cover images, achievement shards, and the derived JSON the nightly rebuilds. (Git was a poor fit for that half: ~97% of the old `data` branch was binary blobs and machine output across 3,000 versions.)

The browser can't read `main` without a deploy, so R2 also holds a serving copy of the git-owned files. Publish writes both — git keeps the history, the bucket makes it live immediately.

| File | Contents |
|------|----------|
| `data/games.json` | Game entries (title, platforms, extras, order) |
| `data/covers.json` | Cover art mappings (title → filename) |
| `data/achievements.json` | Per-game summary counts, keyed by platform ID |
| `data/achievements/<platform>/<id>.json` | Full achievement list for one game |
| `data/overrides/<platform>/<id>.json` | Manual marks on individual achievements |
| `data/overrides/banned.json` | Games excluded from the trophy picker |
| `covers/` | Cover images, named by slugified title |

### Serving

The bucket is fronted by a small Cloudflare Worker (`worker/index.js`) at `game-list-data.arcen-17c.workers.dev`. R2's own S3 endpoint needs signed requests, and its `r2.dev` URL is development-only — the Worker is the no-custom-domain path, and `workers.dev` is supported for production use.

It serves only the `covers/` and `data/` prefixes. `covers/` and `data/xbox-icons/` are cached as immutable — cover URLs carry a `?v=` stamped from the pick time, so re-picking art changes the URL — and everything else revalidates every 5 minutes. Revalidate is the default on purpose: a wrong guess costs one conditional request, where a wrong `immutable` costs a year of browsers refusing to look again.

On the Workers free plan this fails closed at 100k requests/day rather than billing, and R2 egress is always free.

### Nightly round trip

Two workflows, split by what they talk to. **Fetch Achievements** (cron) hits the platform APIs and writes `achievements.json`, the shards, `platform-libraries.json` and `xbox-icons/`. **Build Site Data** (`workflow_run`, after it) derives the leaderboard, timeline and tints from whatever is already in the bucket, and sweeps up any cover that isn't WebP.

They're separate because they fail for unrelated reasons: an expired PSN token has nothing to do with whether the leaderboard can be rebuilt, and used to take it down anyway. Build Site Data is deliberately not gated on the fetch succeeding, and never sees a platform credential — it needs the R2 keys and nothing else.

Both pull, work, and sync back. Two guards make that safe: `r2-pull.mjs` fails hard rather than producing a partial tree, and `r2-sync.mjs` refuses a `--prune` that would remove more than 20% of a prefix — otherwise a short pull would look exactly like mass deletion.

Each sync is scoped with `--only` to what that job produces, so the three writers partition the bucket exactly: fetch owns 791 objects, build owns 3, Publish owns 5. `covers.json` is the one file two jobs touch — the cover sweep re-reads it and writes conditionally on its ETag, so a publish landing mid-run is retried on top rather than reverted.

## Architecture

React + TypeScript + Vite. Single-page app, no router. Game data is fetched at runtime rather than bundled, so data-only changes need no rebuild.

```
game-list/
├── src/
│   ├── components/       # React components
│   ├── hooks/            # Custom hooks (spotlight, swipe, scroll reset, etc.)
│   ├── styles/           # CSS (tokens, layout, game-card, dev, etc.)
│   ├── types/            # TypeScript types
│   └── utils/            # Helpers (achievement matching, cover URLs, platform colors)
├── scripts/              # Data pipeline (fetch, build, R2 sync/pull)
├── worker/               # Cloudflare Worker serving the bucket
├── dev-api-plugin.ts     # Vite plugin — dev-only API endpoints
└── vite.config.ts        # Base path: /game-list/
```

### Achievement data

`achievements.json` holds one summary row per game — title, earned, total — keyed by the platform's own ID (Steam appid, PSN npCommunicationId, Xbox titleId, RA GameID).

The full lists behind those rows are far too large for that file — ~31,000 entries library-wide, about 4MB against the 83KB the app loads per page — so they're sharded one file per game and fetched on demand. That also keeps the nightly's upload proportional to what changed, which only holds while untouched games serialize byte-identically: nothing in a shard is a timestamp, and the writer skips no-op writes.

Definitions don't change once a game ships, so a game whose counts haven't moved isn't re-fetched. Rarity does drift, so shards are re-pulled on a day derived from the game's own ID, spreading the library across the week.

**Xbox old-gen titles** (pre-2017, mostly 360-era) need extra fallback calls beyond the v2 API, which only returns what's already earned for them. See the comment above `fetchXboxAchievementList` in `scripts/fetch-achievements.mjs` for the mechanism and how it was verified.

### Display order

Games are grouped by first letter (ignoring leading "The "), then sorted within each group by an `order` field. Adding a game auto-inserts it alphabetically; drag-and-drop in dev mode updates the numbers.

## Features

- **Spotlight** — scroll-driven dimming. Cards near the viewport center (biased to the upper third) are fully lit; others dim with desaturation and a grain overlay. Driven by `--card-dim`; toggle with "Lights On/Off".
- **Achievement bars** — completion bars under each card, colored by platform (Steam gray, PSN blue, Xbox green, 100% gold). They load and unload in sync with the spotlight.
- **Game of Games** — a best-of flag, with a gold foil border and a custom tagline.

### Views

Swipe or use the bottom nav:

- **All Games** — full alphabetical grid with spotlight
- **Backlog** — games still queued up
- **Leaderboard** — top games by achievement score, rarest unlocks, completions filter
- **Stats** — platform breakdown with bar charts
- **Trophy Picker** — dev only; the picker writes through the dev API, so it has no meaning on the deployed site

Games of Games is a *filter* on All Games rather than a view of its own — toggled from the cable-box key, lit with the foil itself.

The sticky masthead flips between the app title and an alphabet nav, after 80px of scroll or 3 seconds of dwell.

## Trophy Picker

Dev-only view that draws a random unearned achievement and asks you to go earn it. It writes through the dev API, so it's gated on `import.meta.env.DEV` at the point of use — the whole feature tree-shakes out of the production bundle.

The pool is every game in `achievements.json` with something left to earn — the full owned library, not just the curated list. It picks a game weighted by unearned count then an achievement uniformly within it, which works out exactly uniform across the whole pool; games at 100% carry zero weight and drop out on their own. The current roll is kept in `localStorage`, so a reload doesn't cost you the achievement you were working on.

### Marks

| Action | Effect |
|--------|--------|
| Earned it | Already earned, before the nightly catches up |
| Skip | Snoozed; returns after N days (default 14) |
| Can't be earned | Dead servers, delisted DLC — never offered again |
| Ban game | Drops the whole game from the pool |
| Undo | Steps back up to ten actions (`Cmd`/`Ctrl+Z`), session only |

Marking a roll doesn't move you off it — **Roll again** or **Same game** is a deliberate next step. Ban game is the exception, since staying on a banned game is meaningless.

Per-achievement marks live one file per game under `data/overrides/<platform>/`, created when a game gets its first mark and deleted when its last is cleared; expired skips are pruned on every write. Bans live in one file, because the picker has to filter its whole pool before weighting it and can't fetch hundreds of files to do so.

All of it is persisted data, not browser storage — committed to `main` and pushed to the bucket by **Publish**, so it survives a fresh clone.

### Other controls

- **Rarity floor** — a slider excluding anything below a given global unlock percentage, applied on the next roll. Unknown rarity passes rather than fails (mostly Steam games with no public stats). A 5% floor removes about a third of the pool; 10% about half.
- **Hidden descriptions** — PSN, Xbox and RA supply these; **Steam withholds them from the Web API entirely**, even for achievements you've unlocked. For those, the controls offer a text box plus a **Look it up ↗** link. Typed text is deliberately not persisted.
- **OBS stage mode** — `?stage=1` strips the page to the card alone on a transparent background, so it composites over gameplay. Point an OBS browser source at it. OBS shares no `localStorage` with your browser, so the roll is relayed through the dev server — keep the picker open in a normal window to drive it (`R` rolls). The band's height derives from `--picker-cover-h` and `--picker-pad-y` in `src/styles/dev/trophy-picker.css`, so retuning it is two numbers.

## Dev UI

All dev features are behind `import.meta.env.DEV` and only appear under `npm run dev`.

- **Add / Edit / Delete Game** — modal with title, platforms, DLC, achievement IDs, Game of Games flag
- **Reorder** — drag and drop within a letter group
- **Cover picker** — click any cover to browse SteamGridDB (prefers 600×900) or upload a local file

Covers are re-encoded to WebP on the way in (600×900, `fit: inside`, quality 82 — matching `fetch-covers.mjs`), and an earlier file under the same slug is removed so a format change leaves no orphan. A 600×900 grid runs ~700KB as PNG against ~85KB as WebP.

This needs `sharp`, deliberately **not** in `package.json` — its ~26 per-platform native packages have transitive deps npm resolves differently per host, so a lockfile written on macOS is missing entries `npm ci` on the Linux runner demands. A postinstall hook installs it locally with `--no-save`, leaving the lockfile untouched; if that ever fails, install it by hand the same way.

**Without it a cover pick fails rather than saving unconverted**, and says why. It used to fall back to writing the original bytes, which reported success and put PNGs eight times the size into the data — and on a corrupt upload wrote whatever arrived, once landing a 10-byte file in `covers.json` described as cover art. Build Site Data also sweeps the bucket nightly for anything that gets through by another route.

### Publishing

The **Publish** button uploads changed data — `games.json`, `covers.json`, cover images, and everything under `data/overrides/` — straight to the R2 bucket, so a cover pick is live without a deploy. Only changed files are sent, compared by MD5 against the object's ETag.

Deletions propagate for overrides only: clearing a game's last mark removes its object too. That sweep is skipped when `public/data/overrides/` doesn't exist locally, so a fresh clone that hasn't pulled yet can't read its own emptiness as "everything was cleared".

Achievement shards aren't published from here — the nightly writes those to the bucket directly.

### Dev API endpoints

Available during `vite serve`. POST unless noted:

| Endpoint | Purpose |
|----------|---------|
| `/api/add-game` | Add a new game |
| `/api/edit-game` | Update game metadata |
| `/api/delete-game` | Remove a game |
| `/api/mark-beaten` | Clear a game's `status`, moving it out of the backlog |
| `/api/reorder-games` | Update display order |
| `/api/add-extra` | Add DLC/extras to a game |
| `/api/browse-covers` | Search SteamGridDB for covers |
| `/api/select-cover` | Download and save a cover from SteamGridDB |
| `/api/upload-cover` | Upload a local cover image |
| `/api/art-fallback` | GET — resolve art via SteamGridDB when a platform's own icon 404s |
| `/api/achievement-override` | Mark one achievement earned / skipped / unachievable (`status: null` clears) |
| `/api/all-overrides` | GET — every marked achievement, for the manage-marks overlay |
| `/api/ban-game` | Toggle a whole game out of the picker pool |
| `/api/dupe-groups` | GET — the leaderboard's duplicate-game grouping |
| `/api/game-links` | Manually correct that grouping (`action: null` unlinks) |
| `/api/picker-state` | GET + POST — relays the current roll to the OBS stage view |
| `/api/publish` | Push data changes to R2 |

## Deployment

- **Code** — push to `main`; GitHub Actions builds and deploys to Pages. Base path is `/game-list/`.
- **Data** — the Publish button, or `npm run sync-data`. No deploy needed.
- **Worker** — `npm run deploy-worker` after editing `worker/index.js`.
