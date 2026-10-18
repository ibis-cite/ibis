import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { App, type PickerApi } from "./App";

const syntheticApi: PickerApi = {
  libraryStatus: async () => ({ state: "loaded", has_snapshot: true, name: "gallery.bib", snapshot_name: "gallery.bib", references: 1, warnings: 0, error: null, note: null }),
  search: async () => [{ id: { source: "synthetic-gallery", native_key: "example" }, key: "example", title: "Synthetic gallery reference", authors: "Example Author", year: 2026, matched: ["title"] }],
  copyCitation: async () => ({ text: "[@example]", warnings: [] }),
  copyFormat: async () => "pandoc",
  shortcutStatus: async () => ({ shortcut: "Ctrl+Shift+Space", registered: true, error: null }),
  chooseLibrary: async () => undefined,
  reloadLibrary: async () => undefined,
  hidePicker: async () => undefined,
  quit: async () => undefined,
  onLibraryChanged: async () => () => undefined,
  onPickerShown: async () => () => undefined,
};

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await Promise.resolve();
  clearMocks();
});

test("a gallery picker uses synthetic providers for search and copy without native IPC", async () => {
  const nativeCalls: string[] = [];
  mockIPC((command) => { nativeCalls.push(command); throw new Error("Native commands must not run in the gallery"); }, { shouldMockEvents: true });
  render(<App api={syntheticApi} preview={{ query: "synthetic" }} />);
  await screen.findByText("Synthetic gallery reference");
  expect((screen.getByLabelText("Search references") as HTMLInputElement).value).toBe("synthetic");
  fireEvent.keyDown(screen.getByLabelText("Search references"), { key: "Enter" });
  await screen.findByText("[@example]");
  expect(nativeCalls).toEqual([]);
});

test("the gallery keeps a seeded copy confirmation available for evidence capture", async () => {
  vi.useFakeTimers();
  render(<App api={syntheticApi} preview={{ copied: { text: "[@preview]", warnings: [] } }} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText("[@preview]")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByText("[@preview]")).toBeTruthy();
});
