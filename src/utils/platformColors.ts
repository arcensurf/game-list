export const PLATFORM_COLORS: Record<string, string> = {
  PSX: '#003087', PS2: '#003087', PS3: '#003087', PS4: '#003087', PS5: '#003087',
  PSP: '#003087', 'PS Vita': '#003087',
  Famicom: '#e4000f', NES: '#e4000f', 'Super Famicom': '#e4000f', SNES: '#e4000f',
  GB: '#e4000f', GBC: '#e4000f', GBA: '#e4000f', N64: '#e4000f', Gamecube: '#e4000f',
  DS: '#e4000f', '3DS': '#e4000f', Wii: '#e4000f', 'Wii U': '#e4000f',
  Switch: '#e4000f', 'Switch 2': '#e4000f', 'Game & Watch': '#e4000f',
  'NES + Famicom': '#e4000f', 'SNES + Super Famicom': '#e4000f',
  'Xbox 360': '#107c10',
  PC: '#6b7280', Mac: '#6b7280', iPhone: '#6b7280', 'CD-i': '#6b7280',
};

// Achievement-platform colors, keyed by the shard platform id rather
// than by console name. Same palette as the console map above —
// PlayStation blue, Xbox green, Steam grey — so an achievement bar and
// a platform badge for the same game agree.
export const ACHIEVEMENT_PLATFORM_COLORS: Record<string, string> = {
  steam: '#6b7280',
  psn: '#003087',
  xbox: '#107c10',
  ra: '#cc9900',
  ffxiv: '#d83434',
};

// Stand-in tints for a leaderboard row whose cover art never resolved,
// so the wash stays the same device rather than switching to a blurred
// photograph that clashed with every tinted row around it.
//
// Each keeps its platform's exact hue and takes the saturation and
// lightness of a real cover tint — the medians of the 311 shipped ones,
// S 71% / L 48%. The brand colours themselves can't be used directly:
// PlayStation blue and Xbox green sit at L 27, well under the tint
// range (p10 is L 36), and would read as a dark smear where every
// neighbouring row reads as colour. Steam keeps its own near-zero
// saturation — it is achromatic on purpose, and saturating it would
// invent a brand colour Steam doesn't have.
export const PLATFORM_TINT_FALLBACK: Record<string, string> = {
  steam: '#6f7684',
  psn: '#2361cf',
  xbox: '#23cf23',
  ra: '#cfa423',
  ffxiv: '#cf3d3d',
};

// Lightened for use as text on the dark surfaces. PlayStation blue and
// Xbox green are picked for filled bars and go muddy as small text, so
// they get the same treatment the platform badges already use.
export const ACHIEVEMENT_PLATFORM_COLORS_LIGHT: Record<string, string> = {
  steam: '#a1a8b4',
  psn: '#5589dd',
  xbox: '#4ade80',
  ra: '#e0b84d',
  ffxiv: '#f06a6a',
};

// Lightened console colours, for platform names set as text on the dark
// surfaces — PlayStation blue and Xbox green go muddy at small sizes in
// their brand form above. Shared by the platform badges and the
// backlog's system headings.
export const PLATFORM_COLORS_LIGHT: Record<string, string> = {
  PSX: '#4a7fd4', PS2: '#4a7fd4', PS3: '#4a7fd4', PS4: '#4a7fd4', PS5: '#4a7fd4',
  PSP: '#4a7fd4', 'PS Vita': '#4a7fd4',
  Famicom: '#ff6b6b', NES: '#ff6b6b', 'Super Famicom': '#ff6b6b', SNES: '#ff6b6b',
  GB: '#ff6b6b', GBC: '#ff6b6b', GBA: '#ff6b6b', N64: '#ff6b6b', Gamecube: '#ff6b6b',
  DS: '#ff6b6b', '3DS': '#ff6b6b', Wii: '#ff6b6b', 'Wii U': '#ff6b6b',
  Switch: '#ff6b6b', 'Switch 2': '#ff6b6b', 'Game & Watch': '#ff6b6b',
  'NES + Famicom': '#ff6b6b', 'SNES + Super Famicom': '#ff6b6b',
  'Xbox 360': '#4ade80',
  PC: '#a1a8b4', Mac: '#a1a8b4', iPhone: '#a1a8b4', 'CD-i': '#a1a8b4',
};

export function getLightColor(platform: string): string {
  return PLATFORM_COLORS_LIGHT[platform] ?? '#a1a8b4';
}

// Manufacturer families, derived from the console-color grouping above
// rather than a second hand-maintained platform list — a platform's
// family is just whichever brand its badge is already tinted for. Any
// platform outside the three brand colors (grey group, or an unknown/
// custom platform with no color at all) falls to Other.
export const PLATFORM_FAMILIES = ['PlayStation', 'Microsoft', 'Nintendo', 'Other'] as const;

const FAMILY_BY_COLOR: Record<string, (typeof PLATFORM_FAMILIES)[number]> = {
  '#003087': 'PlayStation',
  '#107c10': 'Microsoft',
  '#e4000f': 'Nintendo',
};

export function getPlatformFamily(platform: string): (typeof PLATFORM_FAMILIES)[number] {
  const color = PLATFORM_COLORS[platform];
  return (color && FAMILY_BY_COLOR[color]) ?? 'Other';
}
