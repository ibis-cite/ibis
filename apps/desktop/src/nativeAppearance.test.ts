import { afterEach, expect, test, vi } from "vitest";
import { installAccentContrast, installNativeAppearance, setNativeAppearance } from "./nativeAppearance";

afterEach(() => { delete document.documentElement.dataset.nativeAppearance; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("only explicit native success exposes a material", () => {
  for (const bad of [undefined, null, false, {}, "transparent", "vibrancy; color: red"]) {
    setNativeAppearance(bad);
    expect(document.documentElement.dataset.nativeAppearance).toBe("opaque");
  }
  for (const good of ["mica", "vibrancy"]) {
    setNativeAppearance(good);
    expect(document.documentElement.dataset.nativeAppearance).toBe(good);
  }
});

test("subscription is ready before initial state and newer events win", async () => {
  let resolve!: (value: unknown) => void;
  let changed!: (value: unknown) => void;
  const unsubscribe = vi.fn();
  const ready = installNativeAppearance(() => new Promise((done) => { resolve = done; }), async (handler) => {
    changed = handler;
    return unsubscribe;
  });
  expect(document.documentElement.dataset.nativeAppearance).toBe("opaque");
  await Promise.resolve();
  changed("opaque");
  resolve("mica");
  const dispose = await ready;
  expect(document.documentElement.dataset.nativeAppearance).toBe("opaque");
  dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test("read and subscription failures keep opacity", async () => {
  const unsubscribe = vi.fn();
  await installNativeAppearance(async () => { throw new Error("synthetic"); }, async () => unsubscribe);
  expect(document.documentElement.dataset.nativeAppearance).toBe("opaque");
  const read = vi.fn(async () => "mica");
  await installNativeAppearance(read, async () => { throw new Error("synthetic"); });
  expect(document.documentElement.dataset.nativeAppearance).toBe("opaque");
  expect(read).not.toHaveBeenCalled();
});

test("live native changes replace startup state and reject invalid modes", async () => {
  let changed!: (value: unknown) => void;
  const dispose = await installNativeAppearance(async () => "mica", async (handler) => {
    changed = handler;
    return () => {};
  });
  expect(document.documentElement.dataset.nativeAppearance).toBe("mica");
  changed("opaque");
  expect(document.documentElement.dataset.nativeAppearance).toBe("opaque");
  changed("vibrancy");
  expect(document.documentElement.dataset.nativeAppearance).toBe("vibrancy");
  changed({ mode: "mica" });
  expect(document.documentElement.dataset.nativeAppearance).toBe("opaque");
  dispose();
});

test("older engines repair unreadable accent text and refresh on system changes", () => {
  vi.useFakeTimers();
  let background = "rgb(0, 117, 255)";
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("CSS", { supports: () => false });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false,
    addEventListener: (_: string, listener: () => void) => listeners.set(query, listener),
    removeEventListener: () => {} }));
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ backgroundColor: background }) as CSSStyleDeclaration);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: () => {}, fillRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray([...background.match(/\d+/g)!.map(Number), 255]) }),
  } as unknown as CanvasRenderingContext2D);
  const dispose = installAccentContrast();
  const text = () => document.documentElement.style.getPropertyValue("--readable-accent-text");
  expect(text()).toBe("#000"); // Native white is only 4.21:1; black is 4.99:1.
  background = "rgb(0, 40, 100)";
  vi.advanceTimersByTime(1_000); // Accent-only change, with no focus/theme event.
  expect(text()).toBe("#fff");
  const read = vi.mocked(window.getComputedStyle);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  read.mockClear(); vi.advanceTimersByTime(1_000);
  expect(read).not.toHaveBeenCalled();
  hidden.mockRestore();
  background = "rgb(255, 230, 0)";
  listeners.get("(prefers-color-scheme: dark)")!();
  expect(text()).toBe("#000");
  background = "rgb(0, 40, 100)";
  setNativeAppearance("vibrancy");
  expect(text()).toBe("#fff");
  const forced = window.matchMedia("(forced-colors: active)");
  vi.stubGlobal("matchMedia", () => ({ ...forced, matches: true }));
  setNativeAppearance("opaque");
  expect(text()).toBe("");
  dispose();
  read.mockClear(); vi.advanceTimersByTime(1_000);
  expect(read).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("focus"));
  expect(text()).toBe("");
  vi.stubGlobal("matchMedia", undefined);
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  const unavailable = installAccentContrast();
  expect(text()).toBe("");
  unavailable();
});
