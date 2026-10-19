// Formatted citations with Zotero's build of citeproc-js (ADR 0007). This
// module runs anywhere, including the worker and tests; it never touches the
// network, and styles are data, not code.
import CSL from "../../vendor/csl/citeproc.mjs";
import enUS from "../../vendor/csl/locales/en-US.xml?raw";
import apa from "../../vendor/csl/styles/apa.csl?raw";
import chicago from "../../vendor/csl/styles/chicago-author-date.csl?raw";
import harvard from "../../vendor/csl/styles/harvard-cite-them-right.csl?raw";
import ieee from "../../vendor/csl/styles/ieee.csl?raw";
import mla from "../../vendor/csl/styles/modern-language-association.csl?raw";

export const STYLES = {
  apa: { title: "APA (7th edition)", xml: apa },
  "chicago-author-date": { title: "Chicago (author-date)", xml: chicago },
  "harvard-cite-them-right": { title: "Harvard (Cite Them Right)", xml: harvard },
  ieee: { title: "IEEE", xml: ieee },
  "modern-language-association": { title: "MLA (9th edition)", xml: mla },
} as const;

export type StyleId = keyof typeof STYLES;
export type OutputFormat = "html" | "text" | "rtf";

/** A CSL-JSON item, as `ibis-core` exports it. */
export interface CslItem {
  id: string;
  title?: string;
  [field: string]: unknown;
}

export interface CiteItem {
  id: string;
  locator?: string;
  label?: string;
}

export interface Formatted {
  output: string;
  /** Items shown with a plain fallback because the style could not format them. */
  problems: { id: string; reason: string }[];
}

const FALLBACK_REASON = "this style could not format the reference, so its title is shown instead";

type Engine = InstanceType<typeof CSL.Engine>;

/** One cached engine per style; items are swapped in for each request. */
export class Formatter {
  private engines = new Map<StyleId, Engine>();
  private items = new Map<string, CslItem>();

  private engine(style: StyleId): Engine {
    let engine = this.engines.get(style);
    if (!engine) {
      engine = new CSL.Engine(
        {
          retrieveLocale: () => enUS,
          retrieveItem: (id) => this.items.get(id),
        },
        STYLES[style].xml,
        "en-US",
      );
      this.engines.set(style, engine);
    }
    return engine;
  }

  private attempt<T>(style: StyleId, items: CslItem[], format: OutputFormat, run: (engine: Engine) => T): T {
    this.items = new Map(items.map((item) => [item.id, item]));
    const engine = this.engine(style);
    try {
      engine.setOutputFormat(format);
      engine.updateItems(items.map((item) => item.id));
      return run(engine);
    } catch (error) {
      // The engine may be left half-updated; start the next request afresh.
      this.engines.delete(style);
      throw error;
    }
  }

  /** The in-text citation for `cites`, such as "(Garcia, 2021, p. 13)". */
  citation(style: StyleId, items: CslItem[], cites: CiteItem[], format: OutputFormat): Formatted {
    try {
      const output = this.attempt(style, items, format, (engine) => engine.makeCitationCluster(cites));
      return { output: wrap(output, format, "citation"), problems: [] };
    } catch {
      return this.separately(cites.map((cite) => cite.id), items, format, "citation", (item) =>
        this.attempt(style, [item], format, (engine) =>
          engine.makeCitationCluster(cites.filter((cite) => cite.id === item.id)),
        ),
      );
    }
  }

  /** Bibliography entries for `items`, in the order the style sorts them. */
  bibliography(style: StyleId, items: CslItem[], format: OutputFormat): Formatted {
    try {
      const output = this.attempt(style, items, format, (engine) => entries(engine));
      return { output: wrap(output, format, "bibliography"), problems: [] };
    } catch {
      return this.separately(items.map((item) => item.id), items, format, "bibliography", (item) =>
        this.attempt(style, [item], format, (engine) => entries(engine)),
      );
    }
  }

  /** Format each item on its own so one bad item does not lose the rest. */
  private separately(
    ids: string[],
    items: CslItem[],
    format: OutputFormat,
    kind: "citation" | "bibliography",
    run: (item: CslItem) => string,
  ): Formatted {
    const byId = new Map(items.map((item) => [item.id, item]));
    const problems: Formatted["problems"] = [];
    const parts = [...new Set(ids)].map((id) => {
      const item = byId.get(id);
      try {
        if (!item) throw new Error("missing item");
        return run(item);
      } catch {
        problems.push({ id, reason: item ? FALLBACK_REASON : "the reference is missing" });
        return escape(item?.title || id, format);
      }
    });
    const joined = parts.join(kind === "citation" ? "; " : "\n");
    return { output: wrap(joined, format, kind), problems };
  }
}

function entries(engine: Engine): string {
  const bibliography = engine.makeBibliography();
  if (!bibliography) throw new Error("the style has no bibliography");
  return bibliography[1].map((entry) => entry.trim()).join("\n");
}

/** RTF output from the engine is a fragment; wrap it as a complete document. */
function wrap(output: string, format: OutputFormat, kind: "citation" | "bibliography"): string {
  if (format !== "rtf") return output;
  const body = kind === "bibliography" ? output.split("\n").join("\\par\n") : output;
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\f0\n${body}\n}`;
}

export function escape(text: string, format: OutputFormat): string {
  switch (format) {
    case "html":
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    case "rtf":
      return [...text]
        .map((ch) => {
          const code = ch.codePointAt(0) ?? 0;
          if (ch === "\\" || ch === "{" || ch === "}") return `\\${ch}`;
          if (code < 0x80) return ch;
          // RTF \u takes a signed 16-bit value; astral characters become surrogate pairs.
          return ch.split("").map((unit) => {
            const value = unit.charCodeAt(0);
            return `\\uc0\\u${value > 0x7fff ? value - 0x10000 : value}{}`;
          }).join("");
        })
        .join("");
    case "text":
      return text;
  }
}
