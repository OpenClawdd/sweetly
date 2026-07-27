import { describe, expect, test, beforeEach } from "vitest";
import { installSpicetifyShim } from "../../src/renderer/adapter/spicetifyShim.ts";

const spicetify = (): any => (globalThis as any).Spicetify;

beforeEach(() => {
  delete (globalThis as any).Spicetify;
  installSpicetifyShim();
});

describe("spicetifyShim", () => {
  test("defines the global", () => {
    expect(spicetify()).toBeDefined();
  });

  test("Tippy returns a handle with the methods PageView calls", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const instance = spicetify().Tippy(element, { content: "Close" });
    expect(typeof instance.setContent).toBe("function");
    expect(typeof instance.destroy).toBe("function");
    instance.destroy();
  });

  test("TippyProps is an object so spreading it is safe", () => {
    expect(typeof spicetify().TippyProps).toBe("object");
    expect(spicetify().TippyProps).not.toBeNull();
  });

  test("Player control methods exist and do not throw", () => {
    const player = spicetify().Player;
    expect(() => player.setShuffle(true)).not.toThrow();
    expect(() => player.setRepeat(2)).not.toThrow();
    expect(() => player.addEventListener("songchange", () => {})).not.toThrow();
  });

  test("LocalStorage round-trips values", () => {
    spicetify().LocalStorage.set("sweetly:test", "value");
    expect(spicetify().LocalStorage.get("sweetly:test")).toBe("value");
  });

  test("LocalStorage returns null for unset keys", () => {
    expect(spicetify().LocalStorage.get("sweetly:absent")).toBeNull();
  });

  test("LocalStorage remove clears a key", () => {
    spicetify().LocalStorage.set("sweetly:gone", "x");
    spicetify().LocalStorage.remove("sweetly:gone");
    expect(spicetify().LocalStorage.get("sweetly:gone")).toBeNull();
  });

  test("installing twice does not replace the existing global", () => {
    const first = spicetify();
    installSpicetifyShim();
    expect(spicetify()).toBe(first);
  });

  test("GraphQL exposes the definition dynamicBackground looks up", () => {
    expect(spicetify().GraphQL.Definitions.getDynamicColorsByUris).toBeDefined();
  });

  test("Platform reports a version string that parses as semver parts", () => {
    const parts = spicetify().Platform.version.split(".").map(Number);
    expect(parts).toHaveLength(3);
    expect(parts.every((n: number) => Number.isFinite(n))).toBe(true);
  });
});
