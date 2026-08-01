/**
 * Local replacement for Spicetify's GraphQL `getDynamicColorsByUris`.
 *
 * dynamicBackground.ts expects an object of hex strings under these keys. We
 * derive them on-device from the artwork rather than asking a remote service,
 * so backgrounds keep working offline and no track metadata leaves the machine.
 */

export type ExtractedColors = {
  VIBRANT_NON_ALARMING: string;
  VIBRANT: string;
  DESATURATED: string;
  LIGHT_VIBRANT: string;
  PROMINENT: string;
};

const FALLBACK: ExtractedColors = {
  VIBRANT_NON_ALARMING: "#999999",
  VIBRANT: "#999999",
  DESATURATED: "#7a7a7a",
  LIGHT_VIBRANT: "#c4c4c4",
  PROMINENT: "#999999",
};

const cache = new Map<string, ExtractedColors>();

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function brighten(hex: string, factor: number): string {
  const [r, g, b] = channels(hex);
  return toHex(r * factor, g * factor, b * factor);
}

export function desaturate(hex: string): string {
  const [r, g, b] = channels(hex);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number) => c * 0.4 + grey * 0.6;
  return toHex(mix(r), mix(g), mix(b));
}

/**
 * Picks the most saturated pixel that is neither near-black nor near-white —
 * the same intent as Spotify's VIBRANT_NON_ALARMING, which exists so the
 * background never lands on something unreadable.
 */
export function pickVibrant(data: Uint8ClampedArray): string {
  let best = { score: -1, r: 153, g: 153, b: 153 };
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (lightness < 40 || lightness > 225) continue;
    const denominator = 255 - Math.abs(max + min - 255);
    const saturation = max === min || denominator === 0 ? 0 : (max - min) / denominator;
    const score = saturation * 100 + lightness * 0.1;
    if (score > best.score) best = { score, r, g, b };
  }
  return toHex(best.r, best.g, best.b);
}

export function paletteFrom(vibrant: string): ExtractedColors {
  return {
    VIBRANT_NON_ALARMING: vibrant,
    VIBRANT: vibrant,
    DESATURATED: desaturate(vibrant),
    LIGHT_VIBRANT: brighten(vibrant, 1.35),
    PROMINENT: vibrant,
  };
}

export async function extractColors(imageUrl: string): Promise<ExtractedColors> {
  if (!imageUrl) return FALLBACK;

  const cached = cache.get(imageUrl);
  if (cached) return cached;

  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      // A dead host can leave both onload and onerror unfired indefinitely.
      // Without this the promise never settles and the caller never applies a
      // background at all — worse than applying the fallback palette.
      const timer = setTimeout(() => reject(new Error("artwork load timed out")), 3000);
      image.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error("artwork load failed"));
      };
      image.src = imageUrl;
    });

    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return FALLBACK;

    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const colors = paletteFrom(pickVibrant(data));
    cache.set(imageUrl, colors);
    return colors;
  } catch {
    return FALLBACK;
  }
}
