import { useEffect, useId, useState } from "react";
import type { Choice } from "./features/picker/choice";
import type { Sources } from "./bindings";
import { loginItemText, pickerText, setupText } from "./messages";
import { STYLE_NAMES, type StyleId } from "./format/styles";
import { KeyCaps } from "./ui/KeyCaps";

type SetupApi = {
  chooseLibrary: () => Promise<unknown>;
  useZotero: () => Promise<unknown>;
  findSources?: () => Promise<Sources>;
  openFoundLibrary?: (list: number, index: number) => Promise<unknown>;
};

type Action = "choose" | "zotero" | "findSources" | "openFound";

/** Where people write, and the copy format that suits each. */
const WRITING_PLACES: { name: string; short: string; choice: Choice; formatted?: true }[] = [
  { name: setupText.places.markdown, short: setupText.short.markdown, choice: "pandoc" },
  { name: setupText.places.latex, short: setupText.short.latex, choice: "cite" },
  { name: setupText.places.typst, short: setupText.short.typst, choice: "typst" },
  { name: setupText.places.word, short: setupText.short.word, choice: "style:apa", formatted: true },
];

// Kept here for imports written before the label moved to keys.ts.
export { shortcutLabel } from "./keys";

// First-run setup while no library is chosen: Zotero if it is open, `.bib`
// files found nearby, or any file through the system chooser. Only names are
// shown; nothing is read until one is picked.
export function LibrarySetup({ api, perform, writing, shortcut, startAtLogin }: {
  api: SetupApi;
  perform: (action: Action, run: () => Promise<unknown>) => Promise<void>;
  /** The copy format now, whether formatted styles are offered, and how to change it. */
  writing?: { format: Choice; formatted: boolean; choose: (choice: Choice) => void };
  /** The shortcut that opens Ibis, when it is registered. */
  shortcut?: string | null;
  /** Starting at login, offered once here and kept in More; off until chosen. */
  startAtLogin?: { name: string; enabled: boolean; toggle: () => void };
}) {
  const { chooseLibrary, useZotero, findSources, openFoundLibrary } = api;
  // Undefined while looking; null when looking failed or is not offered.
  const [sources, setSources] = useState<Sources | null>();
  const [search, setSearch] = useState(0);
  const heading = useId();

  useEffect(() => {
    if (!findSources) { setSources(null); return; }
    let current = true;
    setSources(undefined);
    void perform("findSources", () => findSources().then(
      (found) => { if (current) setSources(found); },
      // A search replaced or left behind is nobody's failure.
      (error: unknown) => { if (current) { setSources(null); throw error; } },
    ));
    return () => { current = false; };
  }, [findSources, search]);

  const looking = sources === undefined;
  const zotero = sources?.zotero;
  const files = openFoundLibrary ? sources?.files ?? [] : [];
  const lookAgain = () => setSearch((n) => n + 1);
  const outcome = looking ? setupText.looking
    : sources && files.length === 0 && zotero === "absent" ? setupText.nothingFound
    : sources ? setupText.found(files.length, zotero === "available") : "";

  const zoteroFirst = zotero === "available";
  const chooseButton = <button type="button" className={zoteroFirst ? undefined : "primary-button"} aria-label={pickerText.firstRunChoose}
    onClick={() => void perform("choose", chooseLibrary)}>{pickerText.chooseLibrary}</button>;
  const zoteroButton = <button type="button" className={zoteroFirst ? "primary-button" : undefined} title={pickerText.useZoteroTitle}
    onClick={() => void perform("zotero", useZotero)}>{pickerText.useZotero}</button>;

  // One grouped form, as each system's own setup and settings pages are:
  // a title, a line on what happens, then labelled rows with their control
  // at the trailing edge. One primary button: Use Zotero when it is open,
  // otherwise Choose library….
  return (
    <div className="library-setup">
      <div className="setup-intro">
        <p className="setup-title">{pickerText.firstRun}</p>
        {findSources && <p className="setup-lede" role="status">{outcome}</p>}
      </div>
      {zotero === "access_off" && <p className="setup-note">{setupText.zoteroAccessOff}</p>}
      <div className="setup-group">
        <div className="setup-row">
          <span className="setup-label">{setupText.libraryRow}</span>
          <span className="setup-control">{zoteroButton}{chooseButton}</span>
        </div>
        {files.length > 0 && sources && files.map((file, index) => (
          <div className="setup-row setup-found" key={`${sources.list}-${index}`}>
            <span className="setup-label"><bdi className="found-name">{file.name}</bdi>
              {file.folder && <span className="found-folder"><bdi>{file.folder}</bdi></span>}</span>
            <span className="setup-control">
              <button type="button" title={setupText.openFound(file.name, file.folder)}
                onClick={() => void perform("openFound", () => openFoundLibrary!(sources.list, index).catch((error: unknown) => {
                  lookAgain();
                  throw error;
                }))}>{setupText.use}</button>
            </span>
          </div>
        ))}
        {writing && (
          <div className="setup-row">
            <span className="setup-label" id={`${heading}-writing`}>{setupText.writingRow}</span>
            <span className="setup-control segmented" role="group" aria-labelledby={`${heading}-writing`}>
              {WRITING_PLACES.filter((place) => !place.formatted || writing.formatted).map((place) => (
                <button type="button" key={place.name} aria-pressed={writing.format === place.choice}
                  onClick={() => writing.choose(place.choice)}>
                  {place.short}
                </button>
              ))}
            </span>
          </div>
        )}
        {shortcut && (
          <div className="setup-row">
            <span className="setup-label">{setupText.shortcutRow}</span>
            <span className="setup-control" aria-label={shortcut}><KeyCaps text={shortcut} /></span>
          </div>
        )}
        {startAtLogin && (
          <label className="setup-row" title={loginItemText.title}>
            <span className="setup-label">{loginItemText.label(startAtLogin.name)}</span>
            <span className="setup-control"><input type="checkbox" role="switch" className="switch" checked={startAtLogin.enabled} onChange={startAtLogin.toggle} /></span>
          </label>
        )}
      </div>
      {writing?.format.startsWith("style:") && (
        <p className="setup-note">{setupText.styleHint(STYLE_NAMES[writing.format.slice("style:".length) as StyleId] ?? "")}</p>
      )}
      {sources?.cut_short && <p className="setup-note">{setupText.cutShort}</p>}
      {findSources && (
        <button type="button" className="link-button" aria-disabled={looking || undefined} onClick={() => { if (!looking) lookAgain(); }}>
          {setupText.lookAgain}
        </button>
      )}
    </div>
  );
}
