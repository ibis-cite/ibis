import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToggleButton } from "./ToggleButton";

afterEach(() => { cleanup(); delete document.documentElement.dataset.platform; });

test.each(["macos", "windows", "linux"])("%s: a toggle exposes its name, state and keyboard activation", (platform) => {
  document.documentElement.dataset.platform = platform;
  const changed = vi.fn();
  const view = render(<ToggleButton aria-label="Keep Window Open" onChange={changed}>Pin</ToggleButton>);
  const button = screen.getByRole("button", { name: "Keep Window Open" });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  expect(changed).toHaveBeenLastCalledWith(true);
  expect(button.hasAttribute("data-selected")).toBe(true);
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => button.focus());
  expect(button.hasAttribute("data-focus-visible")).toBe(true);
  fireEvent.keyDown(button, { key: " ", code: "Space" });
  expect(button.hasAttribute("data-pressed")).toBe(true);
  fireEvent.keyUp(button, { key: " ", code: "Space" });
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(button.hasAttribute("data-pressed")).toBe(false);
  view.rerender(<ToggleButton aria-label="Keep Window Open" isDisabled onChange={changed}>Pin</ToggleButton>);
  changed.mockClear();
  fireEvent.click(button);
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});
