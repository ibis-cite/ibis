import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ToggleButtonContext } from "react-aria-components";
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

test("shortcut updates preserve the consumer and React Aria context refs", () => {
  const consumer = createRef<HTMLButtonElement>(), context = createRef<HTMLButtonElement>();
  const changed = vi.fn();
  const control = (shortcut?: string) => <ToggleButtonContext.Provider value={{ ref: context }}>
    <ToggleButton ref={consumer} aria-label="Keep Window Open" aria-keyshortcuts={shortcut} isSelected onChange={changed}>Pin</ToggleButton>
  </ToggleButtonContext.Provider>;
  const view = render(control("Control+Shift+P"));
  const button = screen.getByRole("button", { name: "Keep Window Open" });
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+P");
  view.rerender(control("Meta+Shift+P"));
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+P");
  view.rerender(control());
  expect(button.hasAttribute("aria-keyshortcuts")).toBe(false);
  expect(consumer.current).toBe(button); expect(context.current).toBe(button);
  fireEvent.click(button);
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  view.unmount();
  expect(consumer.current).toBeNull(); expect(context.current).toBeNull();
});
