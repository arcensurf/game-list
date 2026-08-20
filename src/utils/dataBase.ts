// In dev, Vite serves `public/` directly. In production the app is
// deployed to GitHub Pages but the data lives on the `data` branch, so
// it's read straight off raw.githubusercontent.com instead of being
// bundled into the Pages artifact.
export const DATA_BASE = import.meta.env.DEV
  ? import.meta.env.BASE_URL
  : 'https://raw.githubusercontent.com/arcensurf/game-list/data/public/';
