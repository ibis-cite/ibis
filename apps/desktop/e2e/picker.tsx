// Synthetic IPC adapter used only by Playwright; the production entry never imports it.
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { App } from "../src/App";
import type { SelectedReference } from "../src/api";
import "../src/styles.css";

declare global {
  interface Window { pickerTest: { copies: { items: SelectedReference[]; format: string }[]; hidden: number } }
}
window.pickerTest = { copies: [], hidden: 0 };
const results = Array.from({ length: 200 }, (_, i) => ({
  id: { source: "synthetic.bib", native_key: `ref${i}` }, key: `ref${i}`,
  title: `Reference ${i}: synthetic research 睡眠 والذاكرة with a wrapped title`, authors: "García; Smith", year: 2024,
  matched: ["title"],
}));
mockIPC((command, payload) => {
  const args = (payload ?? {}) as Record<string, unknown>;
  if (command === "search") return args.query ? (args.query === "reverse" ? [...results].reverse() : results).slice(0, Number(args.limit)) : [];
  if (command === "library_status") return { name: "synthetic.bib", references: 100000, warnings: 0, error: null, note: null };
  if (command === "shortcut_status") return { shortcut: "Control+Shift+Space", registered: true, error: null };
  if (command === "copy_format") return "pandoc";
  if (command === "hide_picker") { window.pickerTest.hidden++; return null; }
  if (command === "copy_citation") {
    window.pickerTest.copies.push({ items: args.items as SelectedReference[], format: String(args.format) });
    return { text: "synthetic citation", warnings: ["Synthetic warning keeps test picker open"] };
  }
  if (command === "reference_details") {
    const id = args.id as { native_key: string };
    return { id, title: `Details ${id.native_key}`, authors: "Alex Smith", year: 2024, kind: "article-journal", container: "Synthetic Journal", doi: "10.0000/synthetic", url: "https://example.invalid", abstract_text: "<script>literal synthetic text</script>" };
  }
  if (["choose_library", "reload_library", "quit"].includes(command)) return null;
  throw new Error(`Unexpected test command: ${command}`);
}, { shouldMockEvents: true });
createRoot(document.getElementById("root")!).render(<App />);
