// In dev, Vite serves `public/` directly. In production the app is
// deployed to GitHub Pages but the data lives in an R2 bucket, fronted
// by a small Worker (see `worker/index.js`) because R2's own S3
// endpoint needs signed requests and its `r2.dev` URL is explicitly
// development-only.
//
// This used to read off raw.githubusercontent.com against the `data`
// branch. Git was the wrong store for it: ~97% of that branch was
// binary blobs and derived output, and raw.githubusercontent caps
// everything at max-age=300 with soft rate limits, so a full page of
// covers was re-fetched constantly.
//
// The layout matches on both sides — `data/…` and `covers/…` are the
// bucket's key prefixes as well as the paths under `public/`.
export const DATA_BASE = import.meta.env.DEV
  ? import.meta.env.BASE_URL
  : 'https://game-list-data.arcen-17c.workers.dev/';
