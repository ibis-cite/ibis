import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { App } from "./App";
import capability from "../src-tauri/capabilities/default.json";

// jsdom does not implement modal dialogs; real webview checks cover native
// focus containment. Model only opening/closing here, without a focus-trap shim.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  // Event listeners are removed asynchronously after unmount; let that
  // finish before the mocked Tauri internals are cleared.
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearMocks();
});

test("copy confirmation expires, but copy warnings remain until dismissed", async () => {
  let warnings: string[] = [];
  backend({
    search: () => [result("a", "First")],
    copy_citation: () => ({ text: "@a", warnings }),
  });
  render(<App />);
  await screen.findByText("First");
  const box = screen.getByLabelText("Search references");
  vi.useFakeTimers();
  await act(async () => { fireEvent.keyDown(box, { key: "Enter" }); });
  expect(screen.getByText("@a")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.queryByText("@a")).toBeNull();
  vi.useRealTimers();
  warnings = ["A warning to read"];
  fireEvent.keyDown(box, { key: "Enter" });
  await screen.findByText("A warning to read");
  vi.useFakeTimers();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByText("A warning to read")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss copy warnings" }));
  expect(screen.queryByLabelText("Copy warnings")).toBeNull();
});

function result(key: string, title: string, source = "refs.bib") {
  return { id: { source, native_key: key }, key, title, authors: "Smith", year: 2020, matched: ["title"] };
}

type Handler = (args: Record<string, unknown>) => unknown;

test("the borderless picker has a permitted drag region around its editable search input", async () => {
  backend();
  render(<App />);
  const box = screen.getByLabelText("Search references");
  expect(box.closest("[data-tauri-drag-region]")).toBeTruthy();
  expect(box.hasAttribute("data-tauri-drag-region")).toBe(false);
  expect(capability.permissions).toContain("core:window:allow-start-dragging");
  fireEvent.change(box, { target: { value: "sleep" } });
  await waitFor(() => expect((box as HTMLInputElement).value).toBe("sleep"));
});

/** Mock the Rust commands; returns the list of commands called. */
function backend(overrides: Record<string, Handler> = {}): string[] {
  const calls: string[] = [];
  const defaults: Record<string, Handler> = {
    shortcut_status: () => ({ shortcut: "Cmd+Shift+Space", registered: true, error: null }),
    search: () => [],
    hide_picker: () => null,
    copy_format: () => "pandoc",
    library_status: () => ({ name: "refs.bib", references: 1, warnings: 0, error: null, note: null }),
  };
  mockIPC(
    (cmd, args) => {
      calls.push(cmd);
      const handler = overrides[cmd] ?? defaults[cmd];
      if (!handler) throw new Error(`unexpected command ${cmd}`);
      return handler((args ?? {}) as Record<string, unknown>);
    },
    { shouldMockEvents: true },
  );
  return calls;
}

test("typing a query shows results from the search command", async () => {
  backend({
    search: ({ query }) =>
      query ? [result("smith2020", "Sleep and memory")] : [],
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText("Search references"), { target: { value: "sleep" } });
  expect(await screen.findByText("Sleep and memory")).toBeTruthy();
  expect(screen.getByText("smith2020")).toBeTruthy();
});

test("errors from the backend are shown, not swallowed", async () => {
  backend({
    search: () => {
      throw new Error("no library is open");
    },
  });
  render(<App />);
  expect((await screen.findByRole("alert")).textContent).toContain("no library is open");
});

test("Escape hides the picker", async () => {
  const calls = backend();
  render(<App />);
  fireEvent.keyDown(screen.getByLabelText("Search references"), { key: "Escape" });
  await waitFor(() => expect(calls).toContain("hide_picker"));
});

test("a shortcut that could not be registered is explained", async () => {
  backend({
    shortcut_status: () => ({ shortcut: "Cmd+Shift+Space", registered: false, error: "another app may be using it" }),
  });
  render(<App />);
  expect((await screen.findByRole("status")).textContent).toContain("another app may be using it");
});

test("a failed search clears the results of the previous query", async () => {
  backend({
    search: ({ query }) => {
      if (query === "diet") throw new Error("search failed");
      return query ? [result("smith2020", "Sleep and memory")] : [];
    },
  });
  render(<App />);
  const box = screen.getByLabelText("Search references");
  fireEvent.change(box, { target: { value: "sleep" } });
  expect(await screen.findByText("Sleep and memory")).toBeTruthy();
  fireEvent.change(box, { target: { value: "diet" } });
  expect((await screen.findByRole("alert")).textContent).toContain("search failed");
  expect(screen.queryByText("Sleep and memory")).toBeNull();
});

test("Quit is available from the picker and from the keyboard", async () => {
  const calls = backend({ quit: () => null });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  fireEvent.click(screen.getByRole("option", { name: "Quit Ibis" }));
  await waitFor(() => expect(calls.filter((c) => c === "quit")).toHaveLength(1));
  fireEvent.keyDown(screen.getByLabelText("Search references"), { key: "q", ctrlKey: true });
  await waitFor(() => expect(calls.filter((c) => c === "quit")).toHaveLength(2));
});

test("a rejected shortcut setting is explained even when the default works", async () => {
  backend({
    shortcut_status: () => ({
      shortcut: "Cmd+Shift+Space",
      registered: true,
      error: 'the shortcut "Control+Nonsense" in settings is not valid; using Cmd+Shift+Space',
    }),
  });
  render(<App />);
  expect((await screen.findByRole("status")).textContent).toContain("Control+Nonsense");
});

test("the query is searched again when a library finishes opening", async () => {
  let open = false;
  backend({
    search: ({ query }) => {
      if (!open) throw new Error("no library is open");
      return query ? [result("smith2020", "Sleep and memory")] : [];
    },
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText("Search references"), { target: { value: "sleep" } });
  expect((await screen.findByRole("alert")).textContent).toContain("no library is open");
  open = true;
  await emit("library:changed", { name: "refs.bib", references: 1, warnings: 0, error: null, note: null });
  expect(await screen.findByText("Sleep and memory")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("Enter copies the highlighted result in the remembered format and hides the picker", async () => {
  const copies: unknown[] = [];
  const calls = backend({
    copy_format: () => "typst",
    search: ({ query }) => (query ? [result("a", "First"), result("b", "Second")] : []),
    copy_citation: (args) => {
      copies.push(args);
      return { text: "@b", warnings: [] };
    },
  });
  render(<App />);
  const box = screen.getByLabelText("Search references");
  await waitFor(() => expect((screen.getByLabelText("Copy as") as HTMLSelectElement).value).toBe("typst"));
  fireEvent.change(box, { target: { value: "s" } });
  await screen.findByText("Second");
  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(calls).toContain("hide_picker"));
  expect(copies).toEqual([{ ids: [{ source: "refs.bib", native_key: "b" }], format: "typst" }]);
  expect(screen.getByRole("status").textContent).toContain("Copied @b");
});

test("the selection is kept by record identity across queries and copied in order", async () => {
  const copies: unknown[] = [];
  backend({
    search: ({ query }) =>
      query === "one" ? [result("same", "One", "a.bib")] : query === "two" ? [result("same", "Two", "b.bib")] : [],
    copy_citation: (args) => {
      copies.push(args);
      return { text: "[@same; @same]", warnings: [] };
    },
  });
  render(<App />);
  const box = screen.getByLabelText("Search references");
  fireEvent.change(box, { target: { value: "one" } });
  await screen.findByText("One");
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  fireEvent.change(box, { target: { value: "two" } });
  fireEvent.click(await screen.findByText("Two"));
  expect(screen.getAllByRole("button", { name: /Remove same/ })).toHaveLength(2);
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(copies).toHaveLength(1));
  expect(copies[0]).toEqual({
    ids: [
      { source: "a.bib", native_key: "same" },
      { source: "b.bib", native_key: "same" },
    ],
    format: "pandoc",
  });
});

test("warnings keep the picker open and failures say nothing was copied", async () => {
  let fail = false;
  const calls = backend({
    search: ({ query }) => (query ? [result("a", "First")] : []),
    copy_citation: () => {
      if (fail) throw new Error("the clipboard could not be written");
      return { text: "a", warnings: ["bare keys cannot carry page numbers"] };
    },
  });
  render(<App />);
  const box = screen.getByLabelText("Search references");
  fireEvent.change(box, { target: { value: "f" } });
  await screen.findByText("First");
  fireEvent.keyDown(box, { key: "Enter" });
  expect((await screen.findByLabelText("Copy warnings")).textContent).toContain("page numbers");
  expect(calls).not.toContain("hide_picker");
  fail = true;
  fireEvent.keyDown(box, { key: "Enter" });
  expect((await screen.findByRole("alert")).textContent).toContain("Nothing was copied");
});

test("Enter while composing text with an input method copies nothing", async () => {
  const calls = backend({ search: ({ query }) => (query ? [result("a", "First")] : []) });
  render(<App />);
  const box = screen.getByLabelText("Search references");
  fireEvent.change(box, { target: { value: "f" } });
  await screen.findByText("First");
  fireEvent.keyDown(box, { key: "Enter", isComposing: true });
  fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).not.toContain("copy_citation");
});

test("Enter never copies a result left over from the previous query", async () => {
  let release: (value: unknown) => void = () => undefined;
  const calls = backend({
    search: ({ query }) =>
      query === "old" ? [result("old", "Old result")] : query ? new Promise((resolve) => (release = resolve)) : [],
    copy_citation: () => ({ text: "x", warnings: [] }),
  });
  render(<App />);
  const box = screen.getByLabelText("Search references");
  fireEvent.change(box, { target: { value: "old" } });
  await screen.findByText("Old result");
  fireEvent.change(box, { target: { value: "new" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).not.toContain("copy_citation");
  release([result("new", "New result")]);
  await screen.findByText("New result");
});

test("the library is shown, can be chosen and reloaded, and failures are explained", async () => {
  const calls = backend({
    library_status: () => ({ name: null, references: 0, warnings: 0, error: null, note: null }),
    choose_library: () => null,
    reload_library: () => null,
  });
  render(<App />);
  const bar = screen.getByRole("region", { name: "Library" });
  await waitFor(() => expect(bar.textContent).toContain("No library chosen"));
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  fireEvent.click(screen.getByRole("option", { name: "Choose library…" }));
  await waitFor(() => expect(calls).toContain("choose_library"));
  await emit("library:changed", { name: "refs.bib", references: 3, warnings: 1, error: null, note: null });
  await waitFor(() => expect(bar.textContent).toContain("refs.bib: 3 references, 1 could not be read fully"));
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  fireEvent.click(screen.getByRole("option", { name: "Reload library" }));
  await waitFor(() => expect(calls).toContain("reload_library"));
  await emit("library:changed", {
    name: "refs.bib",
    references: 3,
    warnings: 1,
    error: "cannot read the library file",
    note: null,
  });
  expect((await screen.findByText(/The library could not be opened/)).textContent).toContain("cannot read");
});


test("Actions keyboard toggle focuses its filter and Escape restores the query without hiding", async () => {
  const calls = backend({ search: () => [result("a", "First")] });
  render(<App />);
  await screen.findByText("First");
  const box = screen.getByLabelText("Search references");
  fireEvent.change(box, { target: { value: "keep me" } });
  fireEvent.keyDown(box, { key: "k", ctrlKey: true });
  const filter = screen.getByLabelText("Search actions");
  expect(document.activeElement).toBe(filter);
  fireEvent.keyDown(filter, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(box);
  expect((box as HTMLInputElement).value).toBe("keep me");
  expect(calls).not.toContain("hide_picker");
  fireEvent.keyDown(box, { key: "k", ctrlKey: true });
  fireEvent.keyDown(screen.getByLabelText("Search actions"), { key: "k", ctrlKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("filtered actions share selection and copy handlers, with no stale action after an empty match", async () => {
  const copies: unknown[] = [];
  backend({ search: () => [result("a", "First"), result("b", "Second")], copy_citation: (args) => {
    copies.push(args); return { text: "@a", warnings: ["Check citation"] };
  } });
  render(<App />);
  await screen.findByText("First");
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  let filter = screen.getByLabelText("Search actions");
  fireEvent.keyDown(filter, { key: "ArrowDown" });
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(screen.getByRole("button", { name: "Remove a from the selection" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  filter = screen.getByLabelText("Search actions");
  fireEvent.change(filter, { target: { value: "no such action" } });
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(copies).toHaveLength(0);
  fireEvent.change(filter, { target: { value: "copy citation" } });
  fireEvent.keyDown(filter, { key: "Enter", isComposing: true });
  fireEvent.keyDown(filter, { key: "Enter", keyCode: 229 });
  expect(copies).toHaveLength(0);
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(await screen.findByText("Check citation")).toBeTruthy();
  expect(copies).toEqual([{ ids: [{ source: "refs.bib", native_key: "a" }], format: "pandoc" }]);
});

test("pending results cannot be selected or copied through Actions", async () => {
  backend({ search: ({ query }) => query ? new Promise(() => undefined) : [result("old", "Old")] });
  render(<App />);
  await screen.findByText("Old");
  fireEvent.change(screen.getByLabelText("Search references"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  expect(screen.getByRole("option", { name: "Copy citation" }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("option", { name: "Add to selection" }).getAttribute("aria-disabled")).toBe("true");
});


test("Actions preserves IME text editing and format commands affect the primary copy", async () => {
  const copies: unknown[] = [];
  const calls = backend({ search: () => [result("a", "First")], copy_citation: (args) => {
    copies.push(args); return { text: "@a", warnings: [] };
  } });
  render(<App />);
  await screen.findByText("First");
  const box = screen.getByLabelText("Search references");
  fireEvent.keyDown(box, { key: "k", ctrlKey: true, isComposing: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  const filter = screen.getByLabelText("Search actions");
  fireEvent.keyDown(filter, { key: "Escape", isComposing: true });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(calls).not.toContain("hide_picker");
  fireEvent.change(filter, { target: { value: "copy as Typst" } });
  fireEvent.keyDown(filter, { key: "Enter" });
  expect((screen.getByLabelText("Copy as") as HTMLSelectElement).value).toBe("typst");
  fireEvent.click(screen.getByRole("button", { name: /Copy citation/ }));
  await waitFor(() => expect(copies).toEqual([{ ids: [{ source: "refs.bib", native_key: "a" }], format: "typst" }]));
});

test("macOS uses Command K and leaves Control K as a text-editing shortcut", async () => {
  vi.resetModules();
  const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  try {
    const { actionsShortcut, secondaryShortcut, mac } = await import("./Actions");
    expect(mac).toBe(true);
    const event = { key: "k", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false };
    expect(actionsShortcut(event as never)).toBe(true);
    expect(actionsShortcut({ ...event, ctrlKey: true, metaKey: false } as never)).toBe(false);
    expect(actionsShortcut({ ...event, shiftKey: true } as never)).toBe(false);
    expect(secondaryShortcut({ ...event, key: "Enter" } as never)).toBe(true);
    expect(secondaryShortcut({ ...event, key: "Enter", ctrlKey: true, metaKey: false } as never)).toBe(false);
  } finally { platform.mockRestore(); }
});


test("Quit remains available inside Actions and composition never invokes it", async () => {
  const calls = backend({ quit: () => null });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  const filter = screen.getByLabelText("Search actions");
  fireEvent.keyDown(filter, { key: "q", ctrlKey: true, isComposing: true });
  expect(calls).not.toContain("quit");
  fireEvent.keyDown(filter, { key: "q", ctrlKey: true });
  await waitFor(() => expect(calls).toContain("quit"));
});

test("the secondary shortcut toggles the contextual reference even when actions are filtered", async () => {
  backend({ search: () => [result("a", "First")] });
  render(<App />);
  await screen.findByText("First");
  const box = screen.getByLabelText("Search references");
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  expect(screen.getByRole("button", { name: "Remove a from the selection" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  expect(screen.getByRole("option", { name: "Copy citation" }).textContent).toContain("↵");
  expect(screen.getByRole("option", { name: "Remove from selection" }).textContent).toContain("Ctrl+↵");
  const filter = screen.getByLabelText("Search actions");
  fireEvent.change(filter, { target: { value: "Quit" } });
  fireEvent.keyDown(filter, { key: "Enter", ctrlKey: true, isComposing: true });
  fireEvent.keyDown(filter, { key: "Enter", ctrlKey: true, keyCode: 229 });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(filter, { key: "Enter", ctrlKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove a from the selection" })).toBeNull();
});

test("the secondary shortcut ignores a stale reference in search and filtered Actions", async () => {
  backend({ search: ({ query }) => query ? new Promise(() => undefined) : [result("a", "First")] });
  render(<App />);
  await screen.findByText("First");
  const box = screen.getByLabelText("Search references");
  fireEvent.change(box, { target: { value: "pending" } });
  fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  const filter = screen.getByLabelText("Search actions");
  fireEvent.change(filter, { target: { value: "Quit" } });
  fireEvent.keyDown(filter, { key: "Enter", ctrlKey: true });
  expect(screen.queryByRole("button", { name: "Remove a from the selection" })).toBeNull();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("reopening the picker closes Actions before restoring and selecting search text", async () => {
  backend();
  render(<App />);
  const box = screen.getByLabelText("Search references") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "previous query" } });
  fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
  await act(async () => { await emit("picker:shown"); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(box);
  expect(box.selectionStart).toBe(0);
  expect(box.selectionEnd).toBe(box.value.length);
});
