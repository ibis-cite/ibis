import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { ChipCollection } from "./ChipCollection";

afterEach(async () => {
  cleanup(); await act(async () => { await new Promise(requestAnimationFrame); });
  vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.platform;
});

test.each(["macos", "windows", "linux"])("%s collection keeps opaque item names, removal and accessible grid semantics", async (platform) => {
  document.documentElement.dataset.platform = platform;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  const remove = vi.fn();
  const item = { id: "source\0same", label: <bdi>Label</bdi>, textValue: "Full label", removeLabel: "Remove label", reorderLabel: "Reorder label" };
  render(<main><ChipCollection label="Chosen" items={[item]} inline onRemove={remove} onReorder={() => undefined} /></main>);
  const grid = screen.getByRole("grid", { name: "Chosen" });
  expect(grid.hasAttribute("data-chip-list")).toBe(true);
  const row = screen.getByRole("row", { name: "Full label" });
  expect(row.dataset.chipId).toBe(JSON.stringify(item.id));
  expect(screen.getByRole("button", { name: "Reorder label" }).classList.contains("visually-hidden")).toBe(true);
  act(() => row.focus()); fireEvent.keyDown(row, { key: "Backspace" });
  expect(remove).toHaveBeenCalledExactlyOnceWith(new Set([item.id]));
  expect((await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
});
