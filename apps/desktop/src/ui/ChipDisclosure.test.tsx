import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import axe from "axe-core";
import { ChipDisclosure } from "./ChipDisclosure";

afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise(requestAnimationFrame); });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete document.documentElement.dataset.platform;
});

function mount() {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const parentKeys = vi.fn();
  function Example() {
    const [open, setOpen] = useState(false);
    const search = useRef<HTMLInputElement>(null);
    return <main onKeyDown={parentKeys}>
      <input ref={search} aria-label="Search" />
      <ChipDisclosure label="Chosen labels" triggerLabel="Show all 50 chosen labels" trigger="+44" isOpen={open} onOpenChange={setOpen}>
        <button autoFocus>First chip</button><button>Second chip</button>
        <button onClick={() => { setOpen(false); search.current?.focus(); }}>Return to Search</button>
      </ChipDisclosure>
    </main>;
  }
  render(<Example />);
  return { parentKeys, trigger: screen.getByRole("button", { name: "Show all 50 chosen labels" }), search: screen.getByRole("textbox") };
}

test.each(["macos", "windows", "linux"])("%s disclosure opens a named dialog and Escape closes only that layer", async (platform) => {
  document.documentElement.dataset.platform = platform;
  const { trigger, parentKeys } = mount();
  act(() => trigger.focus());
  fireEvent.click(trigger);
  expect(await screen.findByRole("dialog", { name: "Chosen labels" })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "First chip" })));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  parentKeys.mockClear();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(parentKeys).not.toHaveBeenCalled();
});

test("Enter opens the disclosure without activating a child or reaching a copy handler", async () => {
  const { trigger, parentKeys } = mount();
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" }); fireEvent.keyUp(trigger, { key: "Enter" });
  expect(await screen.findByRole("dialog", { name: "Chosen labels" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "First chip" })).toBeTruthy();
  expect(parentKeys.mock.calls.every(([event]) => event.key !== "Enter")).toBe(true);
});

test("composition and 229 Escape neither close the disclosure nor reach picker shortcuts", async () => {
  const { trigger, parentKeys } = mount();
  fireEvent.click(trigger);
  const child = await screen.findByRole("button", { name: "First chip" });
  act(() => child.focus());
  fireEvent.compositionStart(child);
  fireEvent.keyDown(child, { key: "Escape" });
  fireEvent.compositionEnd(child);
  fireEvent.keyDown(child, { key: "Escape", isComposing: true });
  fireEvent.keyDown(child, { key: "Escape", keyCode: 229 });
  expect(screen.getByRole("dialog", { name: "Chosen labels" })).toBeTruthy();
  expect(parentKeys).not.toHaveBeenCalled();
  fireEvent.keyDown(child, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("closing preserves a newer focus destination", async () => {
  const { trigger, search } = mount();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", { name: "Return to Search" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(document.activeElement).toBe(search);
});

test("the disclosed collection has named controls and no axe violations", async () => {
  const { trigger } = mount();
  fireEvent.click(trigger);
  await screen.findByRole("dialog", { name: "Chosen labels" });
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  try {
    expect((await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  } finally { canvas.mockRestore(); }
});
