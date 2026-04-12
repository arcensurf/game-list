// Controllercons SVGs (tight 64x64 viewBox)
import ps1 from '../icons/svg/outline/ps1.svg';
import ps2 from '../icons/svg/outline/ps2.svg';
import ps3 from '../icons/svg/outline/ps3.svg';
import ps4 from '../icons/svg/outline/ps4.svg';
import ps5 from '../icons/svg/outline/ps5.svg';
import nes from '../icons/svg/outline/nes.svg';
import snes from '../icons/svg/outline/snes.svg';
import n64 from '../icons/svg/outline/n64.svg';
import gamecube from '../icons/svg/outline/gamecube.svg';
import wii from '../icons/svg/outline/wii.svg';
import wiiU from '../icons/svg/outline/wii-u.svg';
import joyConL from '../icons/svg/outline/joy-con-l.svg';
import joyConR from '../icons/svg/outline/joy-con-r.svg';
import xbox360 from '../icons/svg/outline/xbox-360.svg';
import dreamcast from '../icons/svg/outline/dreamcast.svg';

// Custom SVGs (750x750 viewBox, need padding class)
import psp from '../icons/svg/outline/psp.svg';
import vita from '../icons/svg/outline/Vita.svg';
import gameboy from '../icons/svg/outline/gameboy.svg';
import gba from '../icons/svg/outline/gba.svg';
import ds from '../icons/svg/outline/ds.svg';
import ds3 from '../icons/svg/outline/3ds.svg';
import pc from '../icons/svg/outline/PC.svg';
import mac from '../icons/svg/outline/mac.svg';
import iphone from '../icons/svg/outline/iphone.svg';

const PLATFORM_ICON: Record<string, { url: string; solid?: boolean }> = {
  // PlayStation (controllercons — solid fills)
  PSX: { url: ps1, solid: true },
  PS2: { url: ps2, solid: true },
  PS3: { url: ps3, solid: true },
  PS4: { url: ps4, solid: true },
  PS5: { url: ps5, solid: true },
  PSP: { url: psp },
  'PS Vita': { url: vita },
  // Nintendo
  Famicom: { url: nes, solid: true },
  NES: { url: nes, solid: true },
  'NES + Famicom': { url: nes, solid: true },
  'Super Famicom': { url: snes, solid: true },
  SNES: { url: snes, solid: true },
  'SNES + Super Famicom': { url: snes, solid: true },
  N64: { url: n64, solid: true },
  Gamecube: { url: gamecube, solid: true },
  Wii: { url: wii, solid: true },
  'Wii U': { url: wiiU, solid: true },
  Switch: { url: joyConL, solid: true },
  'Switch 2': { url: joyConR, solid: true },
  GB: { url: gameboy },
  GBC: { url: gameboy },
  GBA: { url: gba },
  DS: { url: ds },
  '3DS': { url: ds3 },
  // Xbox / Sega (controllercons — solid fills)
  'Xbox 360': { url: xbox360, solid: true },
  Dreamcast: { url: dreamcast, solid: true },
  // PC / Other
  PC: { url: pc },
  Mac: { url: mac },
  iPhone: { url: iphone },
};

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

const PLATFORM_COLORS_LIGHT: Record<string, string> = {
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

function getLightColor(platform: string): string {
  return PLATFORM_COLORS_LIGHT[platform] ?? '#a1a8b4';
}

export default function PlatformBadge({ platform }: { platform: string }) {
  const icon = PLATFORM_ICON[platform];
  const lightColor = getLightColor(platform);

  return (
    <span className="platform-badge">
      {icon && (
        <span
          className="platform-badge-icon"
          style={{
            backgroundColor: lightColor,
            opacity: icon.solid ? 0.55 : undefined,
            maskImage: `url(${icon.url})`,
            WebkitMaskImage: `url(${icon.url})`,
          }}
        />
      )}
      <span className="platform-badge-name" style={{ color: lightColor }}>{platform}</span>
    </span>
  );
}
