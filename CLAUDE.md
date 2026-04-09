# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A personal game completion tracker — a React app displaying a grid of beaten games with cover art, organized alphabetically. Deployed to GitHub Pages at `/game-list/`.

## Commands

- **Dev server:** `npm run dev` (sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for SGDB API)
- **Build:** `npm run build` (runs `tsc -b && vite build`)
- **Lint:** `npm run lint`
- **Fetch covers:** `npm run fetch-covers` (requires `SGDB_API_KEY` in `.env.local`)
- **Parse markdown:** `npm run parse-markdown` (converts `gamelist.md` to JSON)

No test framework is configured.

## Architecture

React + TypeScript + Vite. No router — single-page app with one view.

### Data flow

Game data lives in `public/data/games.json` and cover mappings in `public/data/covers.json`. These are **fetched at runtime** (not bundled at build time), so data-only changes can be deployed without rebuilding the app. Cover images are in `public/covers/`, named by slugified game title.

Each game has an `order` field that controls display order within its alphabetical letter group. New games are auto-inserted alphabetically; manual reordering (drag-and-drop in dev) updates order numbers without rearranging the JSON array.

### Dev-only features

`dev-api-plugin.ts` is a Vite plugin that adds POST endpoints only during `vite serve`:

- `/api/add-game`, `/api/edit-game`, `/api/add-extra` — game CRUD
- `/api/upload-cover`, `/api/browse-covers`, `/api/select-cover` — cover management via SteamGridDB
- `/api/reorder-games` — drag-and-drop reorder (updates `order` fields)
- `/api/publish` — builds and deploys to GitHub Pages via the Pages deployment API (no git commit)

Components conditionally render dev-only UI behind `import.meta.env.DEV` checks: add game form, cover picker, edit modal, drag-and-drop reordering, and publish button.

### Game of Games

Games can be marked as "Game of Games" (a best-of designation) via the `gameOfGames` field — a tagline string or null. These get a gold gradient border and banner on their card. Toggled via the edit modal.

### Platform system

Platforms are selected from a predefined chip picker (`PlatformPicker.tsx`), not free-text. Colors are defined in `PLATFORM_COLORS` in `PlatformBadge.tsx` (PlayStation=blue, Nintendo=red, Xbox=green, PC/Other=gray). The stats modal merges regional variants: NES + Famicom and SNES + Super Famicom are counted together.

### Key conventions

- Games are grouped by first letter (ignoring leading "The "), sorted within groups by `order` field
- `base: '/game-list/'` in vite.config.ts — all asset/fetch URLs must account for this base path
- Dev API responses return paths without the base prefix; the client prepends `import.meta.env.BASE_URL`
- Edit modal triggers `window.location.reload()` after save to pick up the changed JSON

### Deployment

- **Code changes:** Push to `main` triggers GitHub Actions (`.github/workflows/deploy.yml`) which builds and deploys to GitHub Pages
- **Data changes:** The dev UI "Publish" button deploys directly via the GitHub Pages deployment API — no commit to `main`. Requires `GITHUB_TOKEN` in `.env.local` with Pages write permission.

### Environment variables (`.env.local`)

- `SGDB_API_KEY` — SteamGridDB API key for cover browsing
- `GITHUB_TOKEN` — GitHub fine-grained PAT with Pages write permission for the publish button
