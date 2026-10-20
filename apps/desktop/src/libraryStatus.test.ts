import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { expect, test, vi } from "vitest";
import type { LibraryStatus } from "./bindings";
import { libraryHealth, LibraryStatusLine, zoteroLibraryNames } from "./LibraryStatusLine";
import { ago, libraryMessages, recentUpdate } from "./messages";

const now = Date.UTC(2026, 9, 20, 12, 0);
const hour = 3_600_000;
const file = (overrides: Partial<LibraryStatus> = {}): LibraryStatus => ({
  state: "loaded", zotero: false, zotero_libraries: [], has_snapshot: true, name: "thesis.bib", snapshot_name: "thesis.bib",
  references: 1204, warnings: 0, error: null, note: null, settings_notice: null, updated_at: now - 3 * hour, checked_at: now - 3 * hour, ...overrides,
});
const zotero = (overrides: Partial<LibraryStatus> = {}) => file({
  zotero: true, zotero_libraries: ["user"], name: "Zotero library", snapshot_name: "Zotero library", ...overrides,
});
const kept = "Zotero is not running, or it is not accepting connections; keeping the last loaded references";
const line = (status: LibraryStatus | null | undefined) =>
  [libraryMessages.summary(status), libraryMessages.age(status, now)].filter(Boolean).join(" · ");
const detail = (status: LibraryStatus) => libraryMessages.detail(status, now, (s) => zoteroLibraryNames(s, (id) => `Group ${id}`));

test.each<[string, LibraryStatus | null | undefined, string, ReturnType<typeof libraryHealth>]>([
  ["starting", undefined, "Checking library…", "idle"],
  ["status unavailable", null, "Library details unavailable", "stop"],
  ["first run", file({ state: "none", has_snapshot: false, name: null, snapshot_name: null, references: 0, updated_at: null, checked_at: null }), "No library chosen", "idle"],
  ["opening Zotero", zotero({ state: "loading", has_snapshot: false, snapshot_name: null, references: 0 }), "Zotero · opening…", "idle"],
  ["reloading keeps the count", file({ state: "reloading" }), "thesis.bib · 1,204 references · reloading…", "done"],
  ["just updated", zotero({ updated_at: now - 2 * 60_000, checked_at: now }), "Zotero · 1,204 references · updated 2 minutes ago", "done"],
  ["updated a while ago", zotero({ checked_at: now }), "Zotero · 1,204 references", "done"],
  ["a watched file", file(), "thesis.bib · 1,204 references", "done"],
  ["reading notices", file({ warnings: 2 }), "thesis.bib · 1,204 references · 2 reading notices", "look"],
  ["empty", zotero({ references: 0 }), "Zotero · no references", "look"],
  ["Zotero closed, copy kept", zotero({ state: "error", error: kept, checked_at: now - 2 * hour }), "Zotero · last good copy · read 2 hours ago", "stop"],
  ["never opened", zotero({ state: "error", has_snapshot: false, snapshot_name: null, references: 0, error: "Zotero is not running" }), "Zotero · not opened", "stop"],
  ["failed switch keeps a current library", file({ state: "error", name: "missing.bib", error: `The library file is unavailable${"; keeping the last loaded references"}` }), "thesis.bib · 1,204 references", "stop"],
])("%s", (_, status, expected, health) => {
  expect(line(status)).toBe(expected);
  expect(libraryHealth(status)).toBe(health);
});

test("the age leaves once the update is no longer news", () => {
  expect(libraryMessages.age(file({ updated_at: now - recentUpdate + 1 }), now)).toBe("updated 10 minutes ago");
  expect(libraryMessages.age(file({ updated_at: now - recentUpdate - 1 }), now)).toBeNull();
});

test("relative times are short, never in the future, and turn into dates after a week", () => {
  expect(ago(now + hour, now)).toBe("just now");
  expect(ago(now - 44_000, now)).toBe("just now");
  expect(ago(now - 60_000, now)).toBe("1 minute ago");
  expect(ago(now - 89 * 60_000, now)).toBe("89 minutes ago");
  expect(ago(now - 2 * hour, now)).toBe("2 hours ago");
  expect(ago(now - 30 * hour, now)).toBe("30 hours ago");
  expect(ago(now - 48 * hour, now)).toBe("2 days ago");
  expect(ago(now - 24 * 8 * hour, now)).toBe("on Oct 12");
});

test("the detail says where from, when, and how Ibis keeps it current", () => {
  expect(detail(zotero({ zotero_libraries: ["user", { group: 41 }, { group: 9 }], checked_at: now }))).toMatch(
    /^Zotero: My Library, Group 41, and Group 9\. 1,204 references, read 3 hours ago \(.+\)\. Checked just now\. Checked for changes each time Ibis opens\.$/);
  expect(detail(file({ warnings: 1 }))).toMatch(/^thesis\.bib\. 1,204 references, read 3 hours ago \(.+\)\. 1 reading notice\. Reread whenever the file changes\.$/);
  expect(detail(zotero({ state: "error", error: kept, checked_at: now - 2 * hour }))).toMatch(
    /^Zotero: My Library\. Zotero could not be reached, so Ibis is searching the 1,204 references last checked 2 hours ago \(.+\)\.$/);
  expect(detail(file({ state: "error", name: "missing.bib", error: "The library file is unavailable" }))).toMatch(/^missing\.bib could not be opened\. Still searching thesis\.bib\. 1,204 references/);
  expect(detail(file({ state: "none", has_snapshot: false, name: null }))).toBe("No library chosen");
});

test("missing times from an older backend show no age instead of a wrong one", () => {
  const old = { ...file(), updated_at: undefined, checked_at: undefined } as unknown as LibraryStatus;
  expect(line(old)).toBe("thesis.bib · 1,204 references");
  expect(detail(old)).toBe("thesis.bib. 1,204 references. Reread whenever the file changes.");
});

test("the footer age ticks by itself and comes back current after the picker is shown", () => {
  vi.useFakeTimers({ now });
  try {
    render(createElement(LibraryStatusLine, { library: zotero({ updated_at: now, checked_at: now }), groupName: (id: number) => `Group ${id}` }));
    const item = screen.getByRole("status", { name: "Library status" }).closest(".library-status")!;
    expect(item.textContent).toBe("Zotero · 1,204 references · updated just now");
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(item.textContent).toBe("Zotero · 1,204 references · updated 3 minutes ago");
    act(() => { vi.setSystemTime(now + recentUpdate + 1); window.dispatchEvent(new Event("focus")); });
    expect(item.textContent).toBe("Zotero · 1,204 references");
  } finally {
    vi.useRealTimers();
  }
});
