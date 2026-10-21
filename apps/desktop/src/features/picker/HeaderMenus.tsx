import { useEffect, useState, type RefObject } from "react";
import { pickerText, scopeText } from "../../messages";
import { ToolbarMenu, type ToolbarMenuSection } from "../../ui/ToolbarMenu";
import { choiceName, type Choice } from "./choice";
import { FormatMenu, formatSections } from "./FormatMenu";

/** A loaded source the search can be narrowed to; no count while loading. */
export type ScopeSource = { id: string; name: string; count: number | null };

const NARROW = "(max-width: 519px)";
const ALL = "scope:all";

function useNarrowWindow() {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(NARROW) : null;
  const [narrow, setNarrow] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const change = () => setNarrow(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [query?.media]);
  return narrow;
}

/** The header's menus: the format, and with several sources the scope to
 * search in. Under 520 px, or with Larger text, both share one button. */
export function HeaderMenus({ format, styles, onFormatChange, sources, scope, onScopeChange, largerText, searchRef }: {
  format: Choice; styles: boolean; onFormatChange: (choice: Choice) => void;
  sources: ScopeSource[];
  /** The source searched, or null for all of them. */
  scope: string | null; onScopeChange: (scope: string | null) => void;
  largerText: boolean;
  searchRef: RefObject<HTMLElement | null>;
}) {
  const narrow = useNarrowWindow() || largerText;
  const formatMenu = <FormatMenu format={format} styles={styles} onChange={onFormatChange} searchRef={searchRef} />;
  // With one source there is nothing to choose.
  if (sources.length < 2) return formatMenu;
  const scopeName = sources.find((source) => source.id === scope)?.name ?? scopeText.all;
  const scopeKey = scope === null ? ALL : `scope:${scope}`;
  const scopeSections: ToolbarMenuSection[] = [
    { id: "scope-all", items: [{ id: ALL, label: scopeText.all, prose: true,
      sample: sources.every((source) => source.count !== null) ? scopeText.count(sources.reduce((sum, source) => sum + source.count!, 0)) : undefined }] },
    { id: "scope-sources", items: sources.map((source) => ({ id: `scope:${source.id}`, label: source.name, prose: true,
      sample: source.count === null ? undefined : scopeText.count(source.count) })) },
  ];
  const chooseScope = (key: string) => onScopeChange(key === ALL ? null : key.slice("scope:".length));
  if (narrow) {
    return <ToolbarMenu label={pickerText.copyAs} value={`${choiceName(format)} · ${scopeName}`} width={304}
      buttonLabel={scopeText.combined(choiceName(format), scopeName)}
      sections={[...formatSections(styles), { ...scopeSections[0]!, label: scopeText.searchIn }, scopeSections[1]!]}
      selectedKey={[format, scopeKey]} filterLabel={pickerText.filterFormats} returnFocusRef={searchRef}
      onAction={(key) => (key.startsWith("scope:") ? chooseScope(key) : onFormatChange(key as Choice))} />;
  }
  return <>
    {formatMenu}
    <ToolbarMenu label={scopeText.searchIn} value={scopeName} sections={scopeSections} selectedKey={scopeKey}
      filterLabel={pickerText.filterLibraries} returnFocusRef={searchRef} onAction={chooseScope} />
  </>;
}
