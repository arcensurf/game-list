# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A personal game completion tracker — a static React app displaying a grid of beaten games with cover art, organized alphabetically. Deployed to GitHub Pages at `/game-list/`.

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

Game data lives in `src/data/games.json` and cover mappings in `src/data/covers.json`. These are imported statically at build time (no runtime API calls in production). The `gamelist.md` file is the original source of truth, converted via `scripts/parse-markdown.mjs`.

### Dev-only features

`dev-api-plugin.ts` is a Vite plugin that adds POST endpoints (`/api/add-game`, `/api/edit-game`, `/api/upload-cover`, `/api/browse-covers`, `/api/select-cover`, `/api/add-extra`) only during `vite serve`. Components conditionally render dev-only UI (add game form, cover picker, edit button) behind `import.meta.env.DEV` checks.

### Key conventions

- Games are sorted ignoring leading "The " (e.g., "The Legend of Zelda" sorts under L)
- Cover images stored in `public/covers/`, named by slugified game title
- Platform colors are grouped by family in `PlatformBadge.tsx` (PlayStation=blue, Nintendo=red, Xbox=green, PC/Other=gray)
- `base: '/game-list/'` in vite.config.ts — all asset URLs must account for this base path

### Deployment

Pushes to `main` trigger GitHub Actions (`.github/workflows/deploy.yml`) which builds and deploys to GitHub Pages.
