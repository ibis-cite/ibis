import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { LibraryStatus } from "../../api";
import { ariaKeys, keysFor } from "../../keys";
import { LibraryStatusLine } from "../../LibraryStatusLine";
import "./PickerFooter.css";
import { keyText, pickerText } from "../../messages";
import { currentPlatform } from "../../platform";
import { KeyHint } from "../../ui/KeyCaps";

/** What the keys do now; null where a key does nothing. */
export type KeyHints = { enter: string | null; shiftEnter: string | null; escape: string };

/** The footer: library status, what Enter (or, with Alt held, the other keys)
 * does now, and the More button with its menu. */
export function PickerFooter({ library, groupName, hints, altHeld, actions, more, pinned, onUnpin }: {
  library: LibraryStatus | null | undefined;
  groupName: (id: number) => string;
  hints: KeyHints;
  /** While Alt (⌥) is held, the footer shows the other keys instead of Enter. */
  altHeld: boolean;
  actions: { copy: () => void; add: () => void; escape: () => void };
  /** The More button and its menu. */
  more: React.ReactNode;
  pinned: boolean;
  onUnpin: () => void;
}) {
  const bar = useRef<HTMLElement>(null);
  const hintsRow = useRef<HTMLElement>(null);
  const pin = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const statusSize = useRef<HTMLSpanElement>(null);
  const [statusCompact, setStatusCompact] = useState(false);
  const platform = currentPlatform();
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () => {
      const available = element.clientWidth;
      const preferred = statusSize.current?.getBoundingClientRect().width ?? 0;
      if (!(available > 0 && preferred > 0)) return;
      const width = (node: Element | null) => node?.getBoundingClientRect().width ?? 0;
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      const hintStyle = hintsRow.current ? getComputedStyle(hintsRow.current) : null;
      const innerGap = parseFloat(hintStyle?.columnGap ?? "") || 0;
      const hintMargin = (parseFloat(hintStyle?.marginInlineStart ?? "") || 0) + (parseFloat(hintStyle?.marginInlineEnd ?? "") || 0);
      const actions = [...(hintsRow.current?.children ?? [])];
      const actionWidth = actions.reduce((sum, child) => sum + width(child), 0);
      const pinWidth = width(pin.current), menuWidth = width(menu.current?.querySelector("button") ?? null);
      const bands = 1 + (pinWidth > 0 ? 1 : 0) + (menuWidth > 0 ? 1 : 0) + (actions.length > 0 ? 1 : 0);
      const needed = pinWidth + menuWidth + actionWidth + Math.max(0, actions.length - 1) * innerGap
        + (bands - 1) * gap + (actions.length > 0 ? hintMargin : 0);
      setStatusCompact(preferred + needed > available);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const node of [element, statusSize.current, pin.current, ...(hintsRow.current?.children ?? []), menu.current]) if (node) observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [hints.enter, hints.shiftEnter, hints.escape, altHeld, pinned, platform]);
  return (
    <footer>
      <section ref={bar} aria-label={pickerText.libraryRegion} className="library-bar" data-status-compact={statusCompact || undefined}>
        <span className="footer-fit-measure" aria-hidden="true" inert><span ref={statusSize} className="footer-status-size" /></span>
        <LibraryStatusLine library={library} groupName={groupName} />
        {pinned && <button ref={pin} type="button" className="pin-button" aria-label={pickerText.unpinTitle} title={pickerText.unpinTitle} onClick={onUnpin}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor">
            <path d="M9 4h6l-1 5 4 4H6l4-4z" /><path d="M12 13v7" />
          </svg>
        </button>}
        {(altHeld || hints.enter) && <small ref={hintsRow} className="enter-hints" aria-label={keyText.footer} role="group">
          {altHeld ? <>
            {hints.shiftEnter && <FooterAction label={hints.shiftEnter} keys={keysFor("add")} onAction={actions.add} />}
            <FooterAction label={hints.escape} keys={keysFor("escape")} onAction={actions.escape} />
          </> : hints.enter && <FooterAction label={hints.enter} keys={keysFor("copy")} primary onAction={actions.copy} />}
        </small>}
        <span ref={menu} className="more">
          {more}
        </span>
        {library?.note && <p role="status">{library.note}</p>}
      </section>
    </footer>
  );
}

function FooterAction({ label, keys, primary, onAction }: {
  label: string; keys: string; primary?: boolean; onAction: () => void;
}) {
  const platform = currentPlatform();
  return <button type="button" className="quiet-button footer-action" aria-label={label}
    aria-keyshortcuts={ariaKeys(keys, platform === "macos")} onClick={onAction}>
    <KeyHint label={label} keys={keys} primary={primary} platform={platform} hidden />
  </button>;
}
