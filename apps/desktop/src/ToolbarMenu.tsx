import type React from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toolbarMenuText } from "./messages";
import "./toolbarMenu.css";

/** One choice: what it is called and, on the right, a short sample of what it gives. */
export type ToolbarMenuItem<V extends string> = { value: V; label: string; sample?: string; code?: boolean };
/** A titled run of choices; a menu with one section shows no title. */
export type ToolbarMenuSection<V extends string> = { label: string; items: ToolbarMenuItem<V>[] };

/** More choices than this and typing filters the list instead of jumping to an item. */
export const FILTER_FROM = 8;
/** macOS confirms a pick by blinking the item once before the menu closes. */
const BLINK_MS = 150;

/** Case, accents and leading punctuation ("\autocite") do not matter when matching. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}
const initial = (label: string) => fold(label).replace(/^[^\p{L}\p{N}]+/u, "");

const macLook = () => document.documentElement.dataset.platform === "macos";

/**
 * A toolbar menu (the ARIA menu button pattern): a quiet button with the
 * current value and a chevron opens a menu of radio items with a checkmark on
 * the current one. Focus stays on the menu, which points at the highlighted
 * item with aria-activedescendant, so typing can filter long lists.
 */
export function ToolbarMenu<V extends string>({ name, value, valueText, sections, onChoose, onDone, className }: {
  /** What the choice is, e.g. "Copy as"; the button's name is "<name> <value>". */
  name: string;
  value: V;
  /** The one word the closed button shows. */
  valueText: string;
  sections: ToolbarMenuSection<V>[];
  onChoose: (value: V) => void;
  /** After a pick, focus moves on (to the search box); Escape returns it to the button. */
  onDone: () => void;
  className?: string;
}) {
  const id = useId();
  const menuId = `${id}menu`;
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [blink, setBlink] = useState<V | null>(null);
  const blinkTimer = useRef<number | undefined>(undefined);

  const all = sections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.label })));
  const filters = all.length >= FILTER_FROM;
  const q = fold(query.trim());
  const shown = q ? all.filter((item) => fold(`${item.label} ${item.sample ?? ""} ${item.section}`).includes(q)) : all;
  const at = Math.min(active, shown.length - 1);
  const itemId = (index: number) => `${id}item-${index}`;

  const close = (refocus: "button" | "next" | null) => {
    window.clearTimeout(blinkTimer.current);
    setBlink(null);
    setOpen(false);
    setQuery("");
    if (refocus === "button") button.current?.focus();
    else if (refocus === "next") onDone();
  };
  const openMenu = () => {
    setQuery("");
    setActive(Math.max(all.findIndex((item) => item.value === value), 0));
    setOpen(true);
  };
  const pick = (choice: V) => {
    if (blink !== null) return;
    const finish = () => { setBlink(null); onChoose(choice); close("next"); };
    if (!macLook() || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    setBlink(choice);
    blinkTimer.current = window.setTimeout(finish, BLINK_MS);
  };

  useEffect(() => () => window.clearTimeout(blinkTimer.current), []);
  useEffect(() => {
    if (!open) return;
    menu.current?.focus();
    // A click elsewhere, or the window losing focus (the picker hiding), closes it.
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(null);
    };
    const away = () => close(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", away);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", away); };
  }, [open]);
  // The menu never runs off the bottom of the window; it scrolls instead.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || !element) return;
    const room = window.innerHeight - element.getBoundingClientRect().top - 8;
    element.style.maxHeight = room > 0 ? `${Math.floor(room)}px` : "";
  }, [open]);
  useLayoutEffect(() => {
    if (open && at >= 0) document.getElementById(itemId(at))?.scrollIntoView?.({ block: "nearest" });
  }, [open, at, query]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const key = e.key;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.min(Math.max(at + (key === "ArrowDown" ? 1 : -1), 0), Math.max(shown.length - 1, 0)));
    } else if (key === "Home" || key === "End") {
      e.preventDefault();
      setActive(key === "Home" ? 0 : Math.max(shown.length - 1, 0));
    } else if (key === "Enter" || (key === " " && !query)) {
      e.preventDefault();
      const item = shown[at];
      if (item) pick(item.value);
    } else if (key === "Escape") {
      // Only the menu closes; the picker stays.
      e.preventDefault();
      e.stopPropagation();
      close("button");
    } else if (key === "Tab") {
      e.preventDefault();
      close("next");
    } else if (key === "Backspace" && filters) {
      e.preventDefault();
      e.stopPropagation();
      setQuery((text) => text.slice(0, -1));
      setActive(0);
    } else if (key.length === 1 && plain && filters) {
      // Typed text is the filter's, never a picker key such as "?".
      e.preventDefault();
      e.stopPropagation();
      setQuery((text) => text + key);
      setActive(0);
    } else if (key.length === 1 && plain && key !== " ") {
      // Short menus jump to the next item starting with the letter, as native menus do.
      e.preventDefault();
      e.stopPropagation();
      const letter = fold(key);
      const next = [...shown.slice(at + 1), ...shown.slice(0, at + 1)].find((item) => initial(item.label).startsWith(letter));
      if (next) setActive(shown.indexOf(next));
    }
  };

  let index = -1;
  const groups = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => shown.some((s) => s.value === item.value)) }))
    .filter((section) => section.items.length > 0);
  const titled = sections.length > 1 && !q;
  const nothing = shown.length === 0;

  return (
    <span className={`toolbar-menu${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        ref={button}
        className="toolbar-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${name} ${valueText}`}
        title={name}
        data-value={value}
        onClick={() => (open ? close(null) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="toolbar-menu-value">{valueText}</span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 4.5 3 3 3-3" /></svg>
      </button>
      {open && (
        <div
          id={menuId}
          ref={menu}
          role="menu"
          aria-label={name}
          tabIndex={-1}
          className="toolbar-menu-popover"
          aria-activedescendant={nothing ? undefined : itemId(at)}
          onKeyDown={onMenuKey}
          // Focus moving elsewhere (another menu, the keys overlay) closes it.
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== button.current) close(null); }}
        >
          {filters && (
            <div className="toolbar-menu-filter" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <circle cx="8.75" cy="8.75" r="5.75" /><path d="m13 13 4.5 4.5" />
              </svg>
              {query ? <span className="toolbar-menu-query">{query}</span> : <span>{toolbarMenuText.typeToFilter}</span>}
            </div>
          )}
          {groups.map((section, s) => (
            <div key={section.label} role="group" aria-label={titled ? section.label : undefined}>
              {s > 0 && <div role="separator" className="toolbar-menu-separator" />}
              {titled && <div className="toolbar-menu-heading" aria-hidden="true">{section.label}</div>}
              {section.items.map((item) => {
                index += 1;
                const mine = index;
                const checked = item.value === value;
                return (
                  <div
                    key={item.value}
                    id={itemId(mine)}
                    role="menuitemradio"
                    aria-checked={checked}
                    data-value={item.value}
                    data-highlighted={mine === at || undefined}
                    data-blink={blink === item.value || undefined}
                    className="toolbar-menu-item"
                    onMouseMove={() => { if (mine !== at) setActive(mine); }}
                    onClick={() => pick(item.value)}
                  >
                    <span className="toolbar-menu-check" aria-hidden="true">
                      {checked && (
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"
                          strokeLinecap="round" strokeLinejoin="round"><path d="m5 10.5 3.2 3.2L15 6.5" /></svg>
                      )}
                    </span>
                    <span className="toolbar-menu-label">{item.label}</span>
                    {item.sample && <span className={item.code ? "toolbar-menu-sample code" : "toolbar-menu-sample"}>{item.sample}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {nothing && <div className="toolbar-menu-empty" aria-hidden="true">{toolbarMenuText.nothingMatches(query)}</div>}
        </div>
      )}
      {/* Filtering is announced here; a menu may hold only items, groups and separators. */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {open && q ? (nothing ? toolbarMenuText.nothingMatches(query) : toolbarMenuText.matches(shown.length)) : ""}
      </span>
    </span>
  );
}
