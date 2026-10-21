import type { ReactNode, Ref, RefObject } from "react";
import { pickerText } from "../../messages";
import { Menu } from "../../ui/Menu";
import { KeyHint } from "../../ui/KeyCaps";

export { MenuItem, MenuSection, MenuSeparator } from "../../ui/Menu";

/**
 * The More button and its menu, opened upward from the footer. Ctrl/⌘ K sets
 * `isOpen` from the picker; Tab leaves the menu for the search box.
 */
export function MoreMenu({ isOpen, onOpenChange, buttonRef, searchRef, keys, ariaKeys, accelerator, children }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void;
  buttonRef: Ref<HTMLButtonElement>; searchRef: RefObject<HTMLElement | null>;
  /** The shortcut as shown, and as `aria-keyshortcuts` spells it. */
  keys: string; ariaKeys: string;
  /** The accelerator, for the key caps. */
  accelerator: string;
  children: ReactNode;
}) {
  return <Menu id="more-menu" label={pickerText.more} isOpen={isOpen} onOpenChange={onOpenChange} placement="top end"
    triggerRef={buttonRef} triggerClassName="quiet-button" triggerTitle={pickerText.moreTitle(keys)} triggerKeys={ariaKeys}
    tabFocusRef={searchRef}
    trigger={<KeyHint label={pickerText.more} keys={accelerator} />}>
    {children}
  </Menu>;
}
