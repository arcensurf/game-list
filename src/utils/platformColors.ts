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
