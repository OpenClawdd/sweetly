import { describe, expect, test } from "vitest";
import { parseLocalTTML, parseTTMLTime } from "../../src/renderer/lyrics/toSpicyShape.ts";

const SYLLABLE_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word">
  <body>
    <div>
      <p begin="00:12.500" end="00:15.000">
        <span begin="00:12.500" end="00:12.900">I </span>
        <span begin="00:12.900" end="00:13.400">step </span>
        <span begin="00:13.400" end="00:14.000">on</span>
        <span ttm:role="x-bg" begin="00:14.100" end="00:15.000">
          <span begin="00:14.100" end="00:15.000">yeah</span>
        </span>
      </p>
    </div>
  </body>
</tt>`;

const LINE_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Line">
  <body><div>
    <p begin="00:10.000" end="00:12.000">If we being real</p>
    <p begin="00:12.000" end="00:14.500">I don't know how to feel</p>
  </div></body>
</tt>`;

const STATIC_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body><div>
    <p>If we being real</p>
    <p>I don't know how to feel</p>
  </div></body>
</tt>`;

describe("parseTTMLTime", () => {
  test("parses mm:ss.SSS to milliseconds", () => {
    expect(parseTTMLTime("00:12.500")).toBe(12_500);
  });

  test("parses hh:mm:ss.SSS to milliseconds", () => {
    expect(parseTTMLTime("01:02:03.250")).toBe(3_723_250);
  });

  test("parses bare seconds", () => {
    expect(parseTTMLTime("7.25")).toBe(7_250);
  });

  test("returns 0 for an empty value", () => {
    expect(parseTTMLTime("")).toBe(0);
  });

  test("returns 0 for junk", () => {
    expect(parseTTMLTime("banana")).toBe(0);
  });

  test("returns 0 for null", () => {
    expect(parseTTMLTime(null)).toBe(0);
  });
});

describe("parseLocalTTML — Syllable", () => {
  test("produces Syllable type when spans carry timings", () => {
    expect(parseLocalTTML(SYLLABLE_TTML)!.Type).toBe("Syllable");
  });

  test("maps lead syllables with millisecond timings", () => {
    const result = parseLocalTTML(SYLLABLE_TTML) as any;
    const syllables = result.Content[0].Lead.Syllables;
    expect(syllables).toHaveLength(3);
    expect(syllables[0].Text).toBe("I");
    expect(syllables[0].StartTime).toBe(12_500);
    expect(syllables[0].EndTime).toBe(12_900);
  });

  test("marks IsPartOfWord false when a space follows the syllable", () => {
    const result = parseLocalTTML(SYLLABLE_TTML) as any;
    expect(result.Content[0].Lead.Syllables[0].IsPartOfWord).toBe(false);
  });

  test("marks IsPartOfWord true when no space follows the syllable", () => {
    const result = parseLocalTTML(SYLLABLE_TTML) as any;
    expect(result.Content[0].Lead.Syllables[2].IsPartOfWord).toBe(true);
  });

  test("separates x-bg spans into Background and keeps them out of Lead", () => {
    const result = parseLocalTTML(SYLLABLE_TTML) as any;
    expect(result.Content[0].Background).toHaveLength(1);
    expect(result.Content[0].Background[0].Syllables[0].Text).toBe("yeah");
    expect(result.Content[0].Lead.Syllables.map((s: any) => s.Text)).not.toContain("yeah");
  });

  test("sets StartTime to the first line's start", () => {
    expect((parseLocalTTML(SYLLABLE_TTML) as any).StartTime).toBe(12_500);
  });

  test("omits Background when a line has no backing vocals", () => {
    const ttml = `<tt><body><div><p begin="00:01.000" end="00:02.000">
      <span begin="00:01.000" end="00:02.000">solo</span></p></div></body></tt>`;
    expect((parseLocalTTML(ttml) as any).Content[0].Background).toBeUndefined();
  });
});

describe("parseLocalTTML — Line and Static", () => {
  test("produces Line type when only p elements carry timings", () => {
    const result = parseLocalTTML(LINE_TTML) as any;
    expect(result.Type).toBe("Line");
    expect(result.Content[0].Text).toBe("If we being real");
    expect(result.Content[0].StartTime).toBe(10_000);
    expect(result.Content[1].EndTime).toBe(14_500);
  });

  test("produces Static type when nothing carries timings", () => {
    const result = parseLocalTTML(STATIC_TTML) as any;
    expect(result.Type).toBe("Static");
    expect(result.Lines).toHaveLength(2);
    expect(result.Lines[0].Text).toBe("If we being real");
  });
});

describe("parseLocalTTML — rejection", () => {
  test("returns null for unparseable input", () => {
    expect(parseLocalTTML("not xml at all <<<")).toBeNull();
  });

  test("returns null for TTML with no lines", () => {
    expect(parseLocalTTML("<tt><body><div></div></body></tt>")).toBeNull();
  });

  test("returns null for TTML whose only lines are empty", () => {
    expect(parseLocalTTML("<tt><body><div><p>   </p></div></body></tt>")).toBeNull();
  });
});
