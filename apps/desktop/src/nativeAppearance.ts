import { listen } from "@tauri-apps/api/event";
import { platformOf } from "./platform";

export { platformOf, type Platform } from "./platform";

type Dispose = () => void;
let refreshAccentContrast = () => {};

/** Keep the resolved system fill. Older webviews need its readable foreground
 * calculated here; current engines update contrast-color() directly in CSS. */
export function installAccentContrast(): Dispose {
  if (typeof CSS !== "undefined" && CSS.supports("color", "contrast-color(white)")) return () => {};
  const root = document.documentElement;
  const probe = document.createElement("span");
  probe.hidden = true;
  probe.style.backgroundColor = "var(--selected-background)";
  document.body.append(probe);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const media = (query: string) => typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
  let sampledColor = "";
  const refresh = () => {
    const contrast = ["(forced-colors: active)", "(prefers-contrast: more)"].some((query) => media(query)?.matches)
      || root.dataset.galleryTheme === "contrast";
    if (contrast || !context) {
      root.style.removeProperty("--readable-accent-text"); sampledColor = ""; return;
    }
    const color = getComputedStyle(probe).backgroundColor;
    if (color === sampledColor) return;
    root.style.removeProperty("--readable-accent-text");
    // Let the engine parse modern rgb(), percentages and wide-gamut color().
    // The default canvas readback converts them to sRGB, independent of syntax.
    let rgba: Uint8ClampedArray;
    try {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "transparent";
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      rgba = context.getImageData(0, 0, 1, 1).data;
    } catch { return; } // Unavailable readback retains the native/fallback pair.
    if (rgba[3] !== 255) return; // An unresolved/transparent role keeps its CSS fallback.
    const channels = Array.from(rgba).slice(0, 3).map((value) => {
      const c = value / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    const luminance = channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
    root.style.setProperty("--readable-accent-text", (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? "#000" : "#fff");
    sampledColor = color;
  };
  const queries = ["(prefers-color-scheme: dark)", "(forced-colors: active)", "(prefers-contrast: more)"].map(media);
  for (const query of queries) query?.addEventListener?.("change", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  // Old engines have no system-accent change event. Match the existing native
  // appearance watch's one-second cadence, doing no work while hidden.
  const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 1_000);
  refreshAccentContrast = refresh;
  refresh();
  return () => {
    for (const query of queries) query?.removeEventListener?.("change", refresh);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
    window.clearInterval(timer);
    refreshAccentContrast = () => {};
    root.style.removeProperty("--readable-accent-text");
    probe.remove();
  };
}

/** Exposes the platform to CSS for its search box, selected row and radius. */
export function setPlatform(name = typeof navigator === "undefined" ? "" : navigator.platform): void {
  document.documentElement.dataset.platform = platformOf(name);
}
type Subscribe = (changed: (value: unknown) => void) => Promise<Dispose>;

export function setNativeAppearance(value: unknown): void {
  document.documentElement.dataset.nativeAppearance = value === "mica" || value === "vibrancy" ? value : "opaque";
  refreshAccentContrast();
}

/** Subscribe before reading initial state; a newer preference event wins. */
export async function installNativeAppearance(load: () => Promise<unknown>, subscribe: Subscribe = (changed) =>
  listen<unknown>("appearance:changed", (event) => changed(event.payload))): Promise<Dispose> {
  setNativeAppearance("opaque");
  let changed = false;
  let dispose: Dispose = () => {};
  try {
    dispose = await subscribe((value) => { changed = true; setNativeAppearance(value); });
    const initial = await load();
    if (!changed) setNativeAppearance(initial);
  } catch {
    setNativeAppearance("opaque");
    console.error("ibis: native appearance is unavailable; using opaque surface");
  }
  return () => { dispose(); setNativeAppearance("opaque"); };
}
