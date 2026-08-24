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

// Used as a mask image, so the drawing is a silhouette and the colour
// comes from whatever paints behind it. `solid` marks the controllercons
// set, whose filled shapes read much heavier than the outline set at the
// same size — every consumer dials their opacity back to compensate.
export const PLATFORM_ICON: Record<string, { url: string; solid?: boolean }> = {
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
