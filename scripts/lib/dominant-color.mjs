// Dominant-colour extraction for cover art.
//
// The leaderboard used to tint a completed row by blurring the cover
// behind it. Blur is an averaging operation over whatever happens to be
// in frame, so the result depends on composition rather than on the
// game's colour: a cover with a dark sky over a bright logo averages to
// mud, and a wide crop of a portrait image samples the middle band and
// misses the art entirely. Picking a colour deliberately fixes both.
//
// The method is a filtered hue histogram, which is roughly what Android's
// Palette and the various "vibrant" libraries do:
//
//   1. downsample hard — 48x48 is plenty and makes this cheap
//   2. throw away pixels that can't carry a tint: near-black (letterbox
//      bars, dark borders), near-white (logos, blown highlights) and
//      near-grey (backgrounds). These dominate by count on most covers
//      and are exactly what a plain average returns.
//   3. bucket what's left by hue, weighting each pixel by its saturation
//      so a small vivid area beats a large washed-out one — which is what
//      a person means by "the colour of the box art"
//   4. average the winning bucket, then force lightness into a band that
//      works as a UI wash: too dark and it's invisible on this page, too
//      light and text can't sit on it.
//
// Falls back to the plain mean for genuinely greyscale covers, since for
// those the mean IS the honest answer.

const SAMPLE = 48;
// Fraction trimmed from each edge before sampling. Packaging chrome lives
// at the edges and artwork lives in the middle: the Xbox 360 case has a
// green band across the top of every box, which made 23% of Xbox tints
// come back green against 1% on every other platform — three different
// Assassin's Creed games all resolved to the same #81c41d, because that
// is the banner, not the art. Trimming also takes out spine strips, ESRB
// blocks and letterbox bars without needing to know what any of them are.
const EDGE_TRIM = 0.16;
const HUE_BUCKETS = 24; // 15 degrees each
const MIN_L = 0.12;
const MAX_L = 0.9;
// Chroma (max - min channel), NOT HSL saturation. HSL saturation is
// computed relative to lightness, so it is wildly overstated for dark
// pixels: a near-black warm shadow like #3a1410 reports 0.57 saturation
// while carrying almost no actual colour. On a red-and-black cover those
// shadows outnumber the true reds many times over, so a saturation filter
// lets them win the bucket — and because their hue sits at 6-11 degrees
// rather than red's 0-3, they drag the result toward orange. Orange at
// mid lightness with mediocre saturation is brown, which is exactly what
// those covers were coming out as. Chroma measures colourfulness in
// absolute terms and throws them out.
// Low enough to admit anything that isn't grey. A hard threshold here was
// a mistake: set high enough to reject dark red-black shadows (chroma
// ~0.16) it also rejected legitimately dark greens, and on one cover it
// discarded 97% of the pixels and let a 27-pixel cyan highlight win by
// default. Shadow and colour are not separable by a single cutoff.
const MIN_CHROMA = 0.06;
// A wash that has been lifted into the usable lightness band needs
// saturation to match, or the lift alone turns a deep colour muddy.
const MIN_WASH_S = 0.45;
// The usable band for a wash sitting on a near-black page.
const WASH_L_MIN = 0.34;
const WASH_L_MAX = 0.62;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * @param {Buffer} imageBuffer raw bytes of any format sharp can read
 * @param {import('sharp')} sharp the sharp module (injected so this file
 *   stays dependency-free and testable)
 * @returns {Promise<string|null>} hex colour, or null if unreadable
 */
export async function dominantColor(imageBuffer, sharp) {
  let data;
  try {
    const img = sharp(imageBuffer);
    const { width, height } = await img.metadata();
    // Explicit, because nothing else crops any more: the resize below
    // squashes rather than cutting, so every edge survives to here.
    const trimmed =
      width && height
        ? img.extract({
            left: Math.round(width * EDGE_TRIM),
            top: Math.round(height * EDGE_TRIM),
            width: Math.round(width * (1 - EDGE_TRIM * 2)),
            height: Math.round(height * (1 - EDGE_TRIM * 2)),
          })
        : img;
    ({ data } = await trimmed
      // 'fill', not 'cover'. This is measuring colour statistics, not
      // composing a picture, so every pixel should be represented in
      // proportion — squashing does that and cropping does not. A square
      // crop discards whatever does not fit, and it discards it from the
      // edges, so on a 320x176 landscape banner it threw away 45% of the
      // width and left only the middle: exactly where the subject is and
      // exactly where the background is not. One cover came back orange
      // off its logo while five sixths of the art was blue.
      .resize(SAMPLE, SAMPLE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    return null;
  }

  const buckets = new Array(HUE_BUCKETS);
  let meanR = 0, meanG = 0, meanB = 0, meanN = 0;

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    meanR += r; meanG += g; meanB += b; meanN++;

    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < MIN_L || l > MAX_L || chroma < MIN_CHROMA) continue;

    const idx = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS));
    const bucket = buckets[idx] ?? (buckets[idx] = { w: 0, h: 0, s: 0, l: 0 });
    // Chroma SQUARED. Area and vividness both matter, and squaring makes
    // vividness count superlinearly while still letting a large area win
    // on volume — which is what a person does when they name the colour of
    // a box. It settles both failure cases without a cutoff:
    //   red/black:  80px dark maroon (0.16) -> 2.0  |  20px red (0.67) -> 9.0
    //   dark green: 2000px green    (0.12) -> 28.8  |  27px cyan (0.40) -> 4.3
    // A linear weight loses the first, a hard threshold loses the second.
    const w = chroma * chroma;
    bucket.w += w;
    // Hue is circular, so accumulate on the unit circle rather than
    // averaging the scalar — otherwise reds either side of 0 cancel out
    // to cyan, which is the classic way this goes wrong.
    bucket.h += w;
    bucket.hx = (bucket.hx ?? 0) + Math.cos(h * 2 * Math.PI) * w;
    bucket.hy = (bucket.hy ?? 0) + Math.sin(h * 2 * Math.PI) * w;
    bucket.s += s * w;
    bucket.l += l * w;
  }

  // Score each bucket with its neighbours included, because a hue bucket
  // is an arbitrary 15-degree slice and real artwork does not respect it.
  // A broad green spread across three adjacent buckets was losing to a
  // narrow cyan spike that happened to land inside one, purely from where
  // the boundaries fell. Neighbours count half, so a wide soft region wins
  // on breadth while a genuinely concentrated colour still wins on depth.
  let best = null;
  let bestScore = 0;
  for (let i = 0; i < HUE_BUCKETS; i++) {
    const bucket = buckets[i];
    if (!bucket) continue;
    const left = buckets[(i - 1 + HUE_BUCKETS) % HUE_BUCKETS];
    const right = buckets[(i + 1) % HUE_BUCKETS];
    const score =
      bucket.w + (left ? left.w : 0) * 0.5 + (right ? right.w : 0) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = bucket;
    }
  }

  if (!best) {
    // Greyscale cover: the mean is the honest answer, just lifted into
    // the usable band.
    if (!meanN) return null;
    const [h, s] = rgbToHsl(meanR / meanN, meanG / meanN, meanB / meanN);
    return hslToHex(h, s, WASH_L_MIN);
  }

  let h = Math.atan2(best.hy, best.hx) / (2 * Math.PI);
  if (h < 0) h += 1;
  const s = Math.min(1, Math.max(MIN_WASH_S, best.s / best.w));
  const l = Math.min(WASH_L_MAX, Math.max(WASH_L_MIN, best.l / best.w));
  return hslToHex(h, s, l);
}
