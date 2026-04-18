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
| `PSN_NPSSO_TOKEN` | PSN authentication token (~60-day lifetime) | Log in at [playstation.com](https://www.playstation.com), then visit [ca.account.sony.com/api/v1/ssocookie](https://ca.account.sony.com/api/v1/ssocookie) and copy the `npsso` value |
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
npm run fetch-covers        # Download cover art from SteamGridDB (requires SGDB_API_KEY in .env.local)
npm run fetch-achievements   # Sync achievement data from Steam, PSN, Xbox (requires secrets in .env.local for local runs)
npm run xbox-get-refresh-token  # Interactive helper to mint a new Xbox refresh token
```

Achievement syncing normally runs automatically via the daily GitHub Actions cron (`fetch-achievements.yml`). You only need to run it locally for debugging. The `xbox-get-refresh-token` helper uses Microsoft's device-code flow — it gives you a URL and code to enter in a browser, then saves the token to `~/.game-list/`.

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
| `achievements.json` | Achievement progress per platform | `public/data/` |
| Cover images | Actual image files, named by slugified title | `public/covers/` |

Production fetches data from the `data` branch on GitHub. The dev server reads from local `public/` files.

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

### Masthead

The sticky header flips between the app title and an alphabet nav. Flips after scrolling 80px or after 3 seconds of dwell time on the list view.

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

### Publishing

The "Publish" button pushes data changes (games.json, covers.json, cover images) directly to the `data` branch via the GitHub API. Only changed files are uploaded (compared by Git blob hash). No git commit to `main` is needed for data-only changes.

### Dev API Endpoints

All POST-only, available during `vite serve`:

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
| `/api/publish` | Deploy data changes to GitHub Pages |

## Deployment

Two paths:

1. **Code changes** — Push to `main` triggers GitHub Actions, which builds and deploys to GitHub Pages
2. **Data changes** — Use the dev UI "Publish" button to push data directly to the `data` branch via the GitHub API

The app's base path is `/game-list/` (configured in `vite.config.ts`).
