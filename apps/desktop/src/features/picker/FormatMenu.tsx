import { useState, type RefObject } from "react";
import { COPY_FORMATS } from "../../api";
import { FORMATTED_STYLES } from "../../format/formatted";
import { STYLE_NAMES, STYLE_SAMPLES } from "../../format/styles";
import { copyFormatMenu, pickerText } from "../../messages";
import { ToolbarMenu, type ToolbarMenuSection } from "../../ui/ToolbarMenu";
import { choiceName, type Choice } from "./choice";
import { composing, isKeysShortcut, isMenuShortcut, isQuitShortcut } from "./shortcuts";

/** The copy format menu: key syntaxes and citation styles, each with a real
 * sample. Styles stay listed but unavailable while the engine is not offered.
 * Focus goes back to the search box after a pick, Escape or Tab. */
export function FormatMenu({ format, styles, onChange, searchRef }: {
  format: Choice;
  /** Whether formatted citation styles can be used now. */
  styles: boolean;
  onChange: (choice: Choice) => void;
  searchRef: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const sections: ToolbarMenuSection[] = [
    { id: "key-formats", label: pickerText.keyFormats, items: COPY_FORMATS.map(({ value }) => ({ id: value, ...copyFormatMenu[value] })) },
    { id: "citation-styles", label: pickerText.formattedStyles, items: FORMATTED_STYLES.map(({ id }) => (
      { id: `style:${id}`, label: STYLE_NAMES[id], sample: STYLE_SAMPLES[id], prose: true, disabled: !styles })) },
  ];
  return <span className="format-menu" onKeyDown={(event) => {
    // Hand off to the app's command layer without leaving this modal beneath it.
    // Composition is stopped by ToolbarMenu before it reaches this handler.
    if (!composing(event) && (isMenuShortcut(event) || isKeysShortcut(event) || isQuitShortcut(event))) setOpen(false);
  }}>
    <ToolbarMenu label={pickerText.copyAs} value={choiceName(format)} sections={sections} selectedKey={format}
      isOpen={open} onOpenChange={setOpen} filterLabel={pickerText.filterFormats}
      onAction={(key) => onChange(key as Choice)} returnFocusRef={searchRef} />
  </span>;
}
