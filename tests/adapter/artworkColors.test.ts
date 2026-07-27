import { describe, expect, test } from "vitest";
import {
  brighten,
  desaturate,
  paletteFrom,
  pickVibrant,
  extractColors,
} from "../../src/renderer/adapter/artworkColors.ts";

/** Builds an RGBA buffer from a list of [r,g,b] pixels, all fully opaque. */
function pixels(list: Array<[number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(list.length * 4);
  list.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

describe("pickVibrant", () => {
  test("prefers the saturated pixel over the grey one", () => {
    expect(pickVibrant(pixels([[128, 128, 128], [220, 20, 60]]))).toBe("#dc143c");
  });

  test("ignores near-black pixels", () => {
    expect(pickVibrant(pixels([[5, 5, 5], [60, 180, 75]]))).toBe("#3cb44b");
  });

  test("ignores near-white pixels", () => {
    expect(pickVibrant(pixels([[250, 250, 250], [60, 180, 75]]))).toBe("#3cb44b");
  });

  test("ignores transparent pixels", () => {
    const data = pixels([[220, 20, 60], [60, 180, 75]]);
    data[3] = 0; // knock out the crimson
    expect(pickVibrant(data)).toBe("#3cb44b");
  });

  test("falls back to grey when every pixel is out of range", () => {
    expect(pickVibrant(pixels([[0, 0, 0], [255, 255, 255]]))).toBe("#999999");
  });
});

describe("colour maths", () => {
  test("brighten scales channels and clamps at 255", () => {
    expect(brighten("#808080", 2)).toBe("#ffffff");
  });

  test("desaturate moves a colour toward its luminance", () => {
    const result = desaturate("#dc143c");
    expect(result).not.toBe("#dc143c");
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(result.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(220 - 20);
  });

  test("paletteFrom fills every key dynamicBackground reads", () => {
    const palette = paletteFrom("#dc143c");
    expect(Object.keys(palette).sort()).toEqual([
      "DESATURATED",
      "LIGHT_VIBRANT",
      "PROMINENT",
      "VIBRANT",
      "VIBRANT_NON_ALARMING",
    ]);
    expect(palette.VIBRANT_NON_ALARMING).toBe("#dc143c");
  });
});

describe("extractColors", () => {
  test("returns the fallback palette for an empty url rather than throwing", async () => {
    const colors = await extractColors("");
    expect(colors.VIBRANT_NON_ALARMING).toBe("#999999");
  });

  test("returns the fallback palette when the image cannot load", async () => {
    const colors = await extractColors("https://example.invalid/missing.png");
    expect(colors.VIBRANT_NON_ALARMING).toBe("#999999");
  });
});
