export const PLATFORM_COLORS: Record<string, string> = {
  // PlayStation family
  PSX: '#003087',
  PS2: '#003087',
  PS3: '#003087',
  PS4: '#003087',
  PS5: '#003087',
  PSP: '#003087',
  'PS Vita': '#003087',
  // Nintendo family
  Famicom: '#e4000f',
  NES: '#e4000f',
  'Super Famicom': '#e4000f',
  SNES: '#e4000f',
  GB: '#e4000f',
  GBC: '#e4000f',
  GBA: '#e4000f',
  N64: '#e4000f',
  Gamecube: '#e4000f',
  DS: '#e4000f',
  '3DS': '#e4000f',
  Wii: '#e4000f',
  'Wii U': '#e4000f',
  Switch: '#e4000f',
  'Switch 2': '#e4000f',
  'Game & Watch': '#e4000f',
  'NES + Famicom': '#e4000f',
  'SNES + Super Famicom': '#e4000f',
  // Xbox family
  'Xbox 360': '#107c10',
  // PC / Other
  PC: '#6b7280',
  Mac: '#6b7280',
  iPhone: '#6b7280',
  'CD-i': '#6b7280',
};

function getColor(platform: string): string {
  return PLATFORM_COLORS[platform] ?? '#6b7280';
}

export default function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span
      className="platform-badge"
      style={{ backgroundColor: getColor(platform) }}
    >
      {platform}
    </span>
  );
}
