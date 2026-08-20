# The Games List

A personal game completion tracker — a React app displaying a grid of beaten games with cover art, organized alphabetically. Features a spotlight scroll effect, achievement tracking, and a dev UI for managing the collection.

**Live site:** [arcensurf.github.io/game-list](https://arcensurf.github.io/game-list/)

## Setup

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
git clone https://github.com/arcensurf/game-list.git
cd game-list
npm install
```

### Pull the Data

`public/data/` and `public/covers/` are gitignored — the real data lives on the `data` branch. A fresh clone has none of it, and the dev server reads local files, so the app comes up empty until you pull it down:

```bash
git fetch origin data
git archive origin/data public/data public/covers | tar x
```

Re-run this whenever the nightly achievement workflow has moved ahead of your checkout. Nothing warns you that local data is stale — the app just quietly shows older achievement counts, and anything added to `achievements.json` since your last pull (cover art, for instance) won't appear at all.

### Environment Variables

Create `.env.local` in the project root:

```env
SGDB_API_KEY=your_steamgriddb_api_key
GITHUB_TOKEN=your_github_pat
```

| Variable | Purpose | Required |
|----------|---------|----------|
| `SGDB_API_KEY` | [SteamGridDB](https://www.steamgriddb.com/) API key for browsing and fetching cover art | For cover management |
| `GITHUB_TOKEN` | GitHub fine-grained PAT with Pages write permission | For the dev publish button |

### GitHub Actions Secrets

Achievement syncing runs automatically via a daily GitHub Actions workflow. The credentials live in **repo secrets** (Settings > Secrets and variables > Actions), not in `.env.local`:

| Secret | Purpose | How to get it |
|--------|---------|---------------|
| `STEAM_API_KEY` | Steam Web API key | [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) |
| `STEAM_USER_ID` | Your Steam64 ID | [steamid.io](https://steamid.io) |
| `PSN_NPSSO_TOKEN` | PSN authentication token (~60-day lifetime) | Run `npm run psn-get-npsso-token` locally and follow the prompts |
| `XBOX_REFRESH_TOKEN` | Xbox Live refresh token (auto-rotates) | Run `npm run xbox-get-refresh-token` locally and follow the prompts |
| `XBOX_EMAIL` | Xbox/Microsoft account email | Used as fallback for Xbox auth |
| `XBOX_PASSWORD` | Xbox/Microsoft account password | Used as fallback for Xbox auth |

The PSN token expires roughly every 60 days. When it does, the workflow automatically opens a GitHub issue with renewal instructions. Xbox tokens auto-rotate as long as the workflow runs at least once every 90 days.

## Running

### Dev Server

```bash
npm run dev
```

Starts Vite at `http://localhost:5173/game-list/` with dev-only UI: add/edit/delete games, pick covers, drag-and-drop reorder, and a publish button.

### Build

```bash
npm run build
```

Runs TypeScript checking then Vite build. Output goes to `dist/`.

### Lint

```bash
npm run lint
```

## Data Scripts

These scripts manage the data files that live in `public/data/`.

```bash
npm run fetch-covers             # Download cover art from SteamGridDB (requires SGDB_API_KEY in .env.local)
npm run fetch-achievements       # Sync achievement data from Steam, PSN, Xbox
npm run psn-get-npsso-token      # Interactive helper to get a PSN authentication token
npm run xbox-get-refresh-token   # Interactive helper to mint an Xbox refresh token
```

Achievement syncing normally runs automatically via the daily GitHub Actions cron (`fetch-achievements.yml`). You only need to run it locally for debugging.

Manual runs of that workflow take a **`force_refresh`** checkbox, which rebuilds every per-game shard instead of skipping games whose counts haven't moved. A first run doesn't need it (a missing shard is always fetched) — it's for when shards exist but are stale in a way the normal checks can't see, such as a change to the shard format or wanting rarity current before the staggered weekly cycle comes round. The token helper scripts walk you through authentication interactively and save tokens to `~/.game-list/` for local use — they also copy the token to your clipboard for pasting into GitHub secrets.

## Architecture

React + TypeScript + Vite. Single-page app, no router.

### Project Structure

```
game-list/
├── src/
│   ├── components/       # React components
│   ├── hooks/            # Custom hooks (spotlight, swipe, scroll reset, etc.)
│   ├── styles/           # CSS modules (theme, layout, game-card, dev, etc.)
│   ├── types/            # TypeScript types
│   └── utils/            # Helpers (achievement matching, cover URLs, platform colors)
├── dev-api-plugin.ts     # Vite plugin — dev-only API endpoints
├── vite.config.ts        # Base path: /game-list/
├── .github/workflows/    # GitHub Actions deployment
└── .env.local            # API keys (not committed)
```

### Data Flow

Game data is **fetched at runtime**, not bundled at build time. This means data-only changes can be deployed without rebuilding the app.

| File | Contents | Location |
|------|----------|----------|
| `games.json` | Game entries (title, platforms, extras, order, etc.) | `public/data/` |
| `covers.json` | Cover art mappings (title to filename) | `public/data/` |
| `achievements.json` | Per-game summary counts, keyed by platform ID | `public/data/` |
| `achievements/<platform>/<id>.json` | Full achievement list for one game | `public/data/` |
| `overrides/<platform>/<id>.json` | Manual marks on individual achievements | `public/data/` |
| `overrides/banned.json` | Games excluded from the trophy picker | `public/data/` |
| Cover images | Actual image files, named by slugified title | `public/covers/` |

Production fetches data from the `data` branch on GitHub. The dev server reads from local `public/` files.

### Achievement Data

`achievements.json` holds one summary row per game — title, earned, total — keyed by the platform's own ID (Steam appid, PSN npCommunicationId, Xbox titleId). Overrides on a game point straight at a row, so changing one takes effect on the next page load without re-running anything.

The individual achievement lists behind those rows are far too large to sit in that file — roughly 31,000 entries library-wide, about 4MB against the 83KB the app loads on every page. They live one file per game under `public/data/achievements/` and are fetched on demand.

Sharding also keeps the nightly commit proportional to what actually changed: a game you played is a one-file diff, not a 4MB rewrite. That only holds while untouched games serialize byte-identically, which is why nothing in a shard is a timestamp and the writer skips no-op writes.

Definitions effectively never change once a game ships, so a game whose counts haven't moved isn't re-fetched. Global rarity does drift, so shards are re-pulled periodically — on a day derived from the game's own ID, spreading the library across the week so a given night refreshes about a seventh of it.

**Known limitation — Xbox locked achievements.** Xbox Live returns only the achievements you have already *earned* for most titles: 176 of 190 come back short, and 7 (all with zero earned) come back empty. Verified against the live API, each producing byte-identical output: `unlockedOnly=false` (no effect — it is already the default), `possibleOnly=true` (no effect, despite being documented as "return all possible results"), and the contract v1 fallback (works for exactly one title). The titles that do come back complete are almost all games that were 100%'d. Steam and PSN are unaffected and fully populated. Don't re-attempt without a new documented endpoint — the dead ends are recorded above `fetchXboxAchievementList` in `scripts/fetch-achievements.mjs`.

### Display Order

Games are grouped by first letter (ignoring leading "The "), then sorted within each group by an `order` field. Adding a game auto-inserts it alphabetically. Drag-and-drop in dev mode updates order numbers.

## Features

### Spotlight Effect

A scroll-driven dimming effect. Cards near the viewport center (biased to the upper third) are fully lit; cards further away dim with reduced brightness, desaturation, and a static grain overlay. Controlled by the `--card-dim` CSS variable (0 = lit, 1 = dim). Toggle with the "Lights On/Off" button.

### Achievement Bars

Progress bars below each card showing achievement completion. Color-coded by platform (Steam = gray, PSN = blue, Xbox = green, 100% = gold). Bars animate in/out in sync with the spotlight — they load when the card is lit and unload when dimmed.

### Game of Games

A "best-of" designation. Games with this flag get a gold gradient border, a pulsing glow, and a banner with a custom tagline. Toggled via the edit modal.

### Views

Swipe left/right (or use the bottom nav) to switch between:

- **All Games** — Full alphabetical grid with spotlight
- **Games of Games** — Curated best-of subset
- **Perfect Games** — 100% achievement completion only
- **Stats** — Platform breakdown with bar charts
- **Trophy Picker** — Dev only; see below

### Masthead

The sticky header flips between the app title and an alphabet nav. Flips after scrolling 80px or after 3 seconds of dwell time on the list view.

## Trophy Picker

Dev-only view that draws a random unearned achievement and asks you to go earn it. It writes through the dev API, so it isn't rendered on the deployed site at all — the view is gated on `import.meta.env.DEV` at the point of use, not just kept out of the nav, so the whole feature tree-shakes out of the production bundle.

### How it draws

The pool is every game in `achievements.json` with something left to earn — the full owned library, not just the curated game list. It picks a game weighted by unearned count, then an achievement uniformly within it. That is exactly uniform across the whole unearned pool: `P(t) = (u_g / U) × (1 / u_g) = 1 / U`. Games at 100% carry zero weight and drop out on their own.

Because a game's summary counts can't tell you whether its remaining achievements are all marked or filtered out, a draw that lands on an empty game re-rolls, bounded, and remembers that game for the session.

Sampling uniformly over *achievements* means games with huge lists dominate — Halo MCC alone is 700 of ~26,000 unearned, so about 2.7% of rolls. Picking the game uniformly first instead is a one-line change to `pickWeighted`.

### Marks

| Action | Effect | Persisted |
|--------|--------|-----------|
| Earned it | Already earned, before the nightly run catches up | Yes |
| Skip | Snoozed; returns to the pool after N days (default 14, adjustable) | Yes |
| Can't be earned | Dead servers, delisted DLC — never offered again | Yes |
| Ban game | Drops the whole game from the pool | Yes |

Per-achievement marks live in `public/data/overrides/<platform>/<id>.json`, one file per marked game, created only when a game actually has a mark and deleted when its last one is cleared. Expired skips are pruned on every write, so the files don't accumulate.

Bans live in one file, `overrides/banned.json`, because the picker has to filter its whole pool before it can weight it and can't fetch hundreds of files to find out what's excluded.

All of it is committed data, pushed by the **Publish** button — it has to survive a fresh clone, so none of it is in browser storage.

### Rarity floor

A slider excludes anything below a given global unlock percentage, applied on the next roll rather than mid-drag. Unknown rarity passes rather than fails, so the legacy Xbox entries don't vanish the moment the slider leaves zero. For scale: a 5% floor removes about a third of the pool, 10% removes about half.

### Hidden descriptions

PSN and Xbox supply descriptions for hidden achievements (100% of them). **Steam withholds them from the Web API by design** — both `GetPlayerAchievements` and `GetSchemaForGame` return them empty, even for achievements you've already unlocked. There is nothing to fetch.

So for those, the controls offer a text box to type the description in by hand, plus a **Look it up ↗** link to `steamcommunity.com/stats/<appid>/achievements/`. The typed text is deliberately not persisted — it shows for the current roll and clears on the next one.

### OBS stage mode

`?stage=1` strips the page to the card alone — no masthead, nav, or controls — with a transparent page background so the panel composites over gameplay rather than sitting on a black rectangle.

Point an OBS **browser source** at `http://localhost:5173/game-list/?stage=1`. At a 1920 canvas the band is **1920×139**, sized to sit under a 16:9 capture.

OBS runs its own browser process, so a browser source shares no `localStorage` or `BroadcastChannel` with the window you're driving from. The current roll is relayed through the dev server instead: the control window publishes each roll, the stage polls once a second and follows. Keep the picker view open in a normal browser to drive it — `R` rolls.

Both the in-app view and the band derive their height from `--picker-cover-h` and `--picker-pad-y` in `src/styles/trophy-picker.css`, so retuning the band is two numbers and the fixed stage height follows automatically.

## Dev UI

All dev features are behind `import.meta.env.DEV` checks and only appear when running `npm run dev`.

### Game Management

- **Add Game** — Button in bottom-right opens a modal with title, platform picker, and DLC fields
- **Edit Game** — Click "Edit" on any card's info panel to modify all fields including achievement IDs and Game of Games status
- **Delete Game** — Available in the edit modal with a two-click confirmation
- **Reorder** — Drag and drop cards within their letter group

### Cover Management

Click any card's cover art to open the cover picker:
- Browse covers from SteamGridDB (prefers 600x900 grids)
- Upload a local image file
- Covers are saved to `public/covers/` as slugified filenames
- Everything is re-encoded to WebP on the way in (600x900, `fit: inside`, quality 82 — the same settings `fetch-covers.mjs` uses), and an earlier file under the same slug is removed so a format change doesn't leave an orphan. A 600x900 grid runs ~700KB as PNG against ~85KB as WebP, and a page view asks for every cover at once.
- This needs `sharp`, which is deliberately **not** in `package.json` — its per-platform native packages break `npm ci` on the Linux CI runner. Install it ad hoc with `npm install --no-save sharp`. Without it, covers still save, just unconverted, with a warning in the dev server log.

### Publishing

The "Publish" button pushes data changes (games.json, covers.json, cover images, and everything under `public/data/overrides/`) directly to the `data` branch via the GitHub API. Only changed files are uploaded (compared by Git blob hash). No git commit to `main` is needed for data-only changes.

Deletions propagate for overrides only — clearing a game's last mark removes its file on the branch too, so it can't come back on the next clone. That sweep is skipped entirely when `public/data/overrides/` doesn't exist locally: `public/data` is gitignored, so a fresh clone has no overrides at all, and without the guard the first publish from one would read that emptiness as "everything was cleared" and wipe every ban and mark off the branch.

Achievement shards are **not** published from here — CI writes those straight to the `data` branch.

### Dev API Endpoints

Available during `vite serve`. POST unless noted:

| Endpoint | Purpose |
|----------|---------|
| `/api/add-game` | Add a new game |
| `/api/edit-game` | Update game metadata |
| `/api/delete-game` | Remove a game |
| `/api/reorder-games` | Update display order |
| `/api/add-extra` | Add DLC/extras to a game |
| `/api/browse-covers` | Search SteamGridDB for covers |
| `/api/select-cover` | Download and save a cover from SteamGridDB |
| `/api/upload-cover` | Upload a local cover image |
| `/api/achievement-override` | Mark one achievement earned / skipped / unachievable (`status: null` clears) |
| `/api/ban-game` | Toggle a whole game out of the trophy picker pool |
| `/api/picker-state` | GET + POST — relays the current roll to the OBS stage view |
| `/api/publish` | Deploy data changes to GitHub Pages |

## Deployment

Two paths:

1. **Code changes** — Push to `main` triggers GitHub Actions, which builds and deploys to GitHub Pages
2. **Data changes** — Use the dev UI "Publish" button to push data directly to the `data` branch via the GitHub API

The app's base path is `/game-list/` (configured in `vite.config.ts`).
