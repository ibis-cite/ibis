import { listen } from "@tauri-apps/api/event";
import "./nativeAccent.css";

/** Only bounded, opaque sRGB reaches CSS; public roles remain in the cascade. */
export function setNativeAccent(value: unknown): void {
  const root = document.documentElement;
  const rgb = Array.isArray(value) && value.length === 3
    && Array.from(value).every((c) => typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1) ? value as number[] : null;
  for (const name of ["fill", "on", "light", "dark"]) root.style.removeProperty(`--native-accent-${name}`);
  delete root.dataset.nativeAccent;
  if (!rgb) return;
  const linear = rgb.map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const l = linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722;
  root.style.setProperty("--native-accent-fill", `color(srgb ${rgb.join(" ")})`);
  root.style.setProperty("--native-accent-on", (l + .05) / .05 >= 1.05 / (l + .05) ? "#000" : "#fff");
  // Retain the hue at the endpoints; the fill itself is never adjusted.
  for (const [theme, base, scale] of [["light", 0, .12], ["dark", .96, .04]] as const) {
    root.style.setProperty(`--native-accent-${theme}`, `color(srgb ${rgb.map((c) => base + c * scale).join(" ")})`);
  }
  root.dataset.nativeAccent = "true";
}

export async function subscribeNativeAccent(): Promise<() => void> {
  let active = true;
  const dispose = await listen<unknown>("accent:changed", ({ payload }) => { if (active) setNativeAccent(payload); });
  return () => { active = false; dispose(); setNativeAccent(null); };
}
