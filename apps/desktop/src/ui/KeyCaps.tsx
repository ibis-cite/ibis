import { keyLabel } from "../keys";
import { isMac, platformOf } from "../platform";
import "./KeyCaps.css";

/** The keys of an accelerator as each system writes them: one cap of joined
 * glyphs on macOS (⌘K, like its menus), one cap per key on Windows (Ctrl K,
 * like PowerToys) and on Linux with a "+" between (Ctrl + K, like GTK's
 * shortcut labels). Decorative: the control says its keys in words. */
export function KeyCaps({ accelerator, text, mac = isMac, linux = typeof navigator !== "undefined" && platformOf(navigator.platform) === "linux" }: {
  accelerator?: string;
  /** A shortcut already written for people, such as a registered global shortcut. */
  text?: string;
  mac?: boolean; linux?: boolean;
}) {
  const label = text ?? keyLabel(accelerator ?? "", mac);
  const parts = mac ? [label] : label === "+" ? ["+"] : label.split(/\+(?!$)/);
  return <span className="key-caps" aria-hidden="true">
    {parts.map((part, i) => <span key={i} className="key-cap-part">
      {i > 0 && linux && <span className="key-plus">+</span>}<kbd>{part}</kbd>
    </span>)}
  </span>;
}

/** A label and its keys, always in that order: the one footer and empty-state hint pattern. */
export function KeyHint({ label, keys, primary }: { label: string; keys: string; primary?: boolean }) {
  return <span className="key-hint" data-primary={primary || undefined}>
    <span className="key-hint-label">{label}</span><KeyCaps accelerator={keys} />
  </span>;
}
