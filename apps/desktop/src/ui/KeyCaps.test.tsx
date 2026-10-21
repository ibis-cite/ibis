import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { KeyCaps, KeyHint } from "./KeyCaps";

const caps = (container: HTMLElement) => [...container.querySelectorAll("kbd")].map((cap) => cap.textContent);

test("macOS joins the glyphs in one cap, as its menus write them", () => {
  const { container } = render(<KeyCaps accelerator="CmdOrCtrl+K" platform="macos" />);
  expect(caps(container)).toEqual(["⌘K"]);
  expect(container.querySelector(".key-plus")).toBeNull();
});

test("Windows gives each key its own cap, with nothing between", () => {
  const { container } = render(<KeyCaps accelerator="CmdOrCtrl+K" platform="windows" />);
  expect(caps(container)).toEqual(["Ctrl", "K"]);
  expect(container.querySelector(".key-plus")).toBeNull();
});

test("GNOME gives each key its own cap with a plus between, as GTK's shortcut labels do", () => {
  const { container } = render(<KeyCaps accelerator="Shift+Enter" platform="linux" />);
  expect(caps(container)).toEqual(["Shift", "Enter"]);
  expect([...container.querySelectorAll(".key-plus")].map((plus) => plus.textContent)).toEqual(["+"]);
});

test("a lone plus or slash key stays one cap", () => {
  const { container } = render(<KeyCaps accelerator="CmdOrCtrl+/" platform="windows" />);
  expect(caps(container)).toEqual(["Ctrl", "/"]);
});

test("a hint names the action first and its keys after", () => {
  const { container } = render(<KeyHint label="Copy as Pandoc" keys="Enter" platform="windows" primary />);
  const hint = container.firstElementChild!;
  expect(hint.firstElementChild?.className).toBe("key-hint-label");
  expect(hint.lastElementChild?.className).toBe("key-caps");
  expect(hint.textContent).toBe("Copy as PandocEnter");
  expect(hint.getAttribute("data-primary")).toBe("true");
});
