import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SPEC_FILE, compare, derive, layout, measureLayout, table } from "./gallery-geometry.mjs";

const spec = JSON.parse(readFileSync(SPEC_FILE, "utf8"));
const design = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "design.md"), "utf8");
const LOOKS = ["macos", "windows", "linux"];

/** The leading number of each platform cell in a docs/design.md table row. */
function designRow(token) {
  const line = design.split("\n").find((row) => row.startsWith(`| \`${token}\``));
  assert.ok(line, `docs/design.md has a ${token} row`);
  return line.split("|").slice(2, 5).map((cell) => Number(cell.trim().match(/^\d+/)?.[0]));
}

test("the geometry spec derives the corner chain and text x that docs/design.md states", () => {
  assert.deepEqual(LOOKS.map((look) => derive(spec, look).rWin), designRow("--r-win"));
  assert.deepEqual(LOOKS.map((look) => derive(spec, look).rRow), designRow("--r-row"));
  assert.deepEqual(LOOKS.map((look) => derive(spec, look).rTile), designRow("--r-tile"));
  const { macos, windows } = { macos: derive(spec, "macos").textX, windows: derive(spec, "windows").textX };
  assert.match(design, new RegExp(`text x .*${macos} px \\(${windows} px on Windows\\)`));
  assert.equal(derive(spec, "linux").textX, macos);
});

test("the geometry spec's row heights, footer and search band are the ones docs/design.md states", () => {
  const prose = design.replace(/\s+/g, " ");
  for (const [density, height] of Object.entries(spec.rowHeight)) {
    assert.match(prose, new RegExp(`${density} ${height} px`, "i"));
  }
  assert.match(prose, new RegExp(`\\| Footer \\| ${spec.footer} px \\|`));
  assert.match(prose, new RegExp(`search band is ${spec.platforms.macos.searchBand} px \\(${spec.platforms.windows.searchBand} px on Windows\\)`));
  assert.equal(spec.platforms.linux.searchBand, spec.platforms.macos.searchBand);
  assert.match(design, /design-geometry\.json/, "docs/design.md names the spec file the check reads");
});

const onSpec = { rowHeight: 58, footer: 40, searchBand: 48, glyphCentre: 40, tileCentre: 40, textX: 60, titleX: 60, rWin: 8, rRow: 4, rField: 4, rTile: 4 };

test("a frame on spec passes every check, within the tolerance", () => {
  const rows = compare(spec, "windows", "normal", "comfortable", { ...onSpec, textX: 60.4, titleX: 60 });
  assert.equal(rows.length, 10);
  assert.ok(rows.every((row) => row.pass), table(rows));
});

test("Larger text scales nested insets but keeps window corners and radius floors fixed", () => {
  const scaled = derive(spec, "macos", 1.15);
  assert.equal(scaled.rWin, 28);
  assert.ok(Math.abs(scaled.rRow - 18.8) < 1e-9);
  assert.equal(scaled.rTile, 6);
  assert.ok(Math.abs(scaled.textX - 73.6) < 1e-9);
});

test("a Larger text frame with scaled insets passes without hiding radius drift", () => {
  const fixture = { ...spec, platforms: { ...spec.platforms, windows: { inset: 4, rWin: 8, rMin: 2, searchBand: 48 } } };
  const measured = { ...onSpec, rowHeight: 66.7, footer: 46, searchBand: 55.2,
    glyphCentre: 46, tileCentre: 46, textX: 69, titleX: 69, rRow: 3.4, rField: 3.4, rTile: 2 };
  const rows = compare(fixture, "windows", "large", "comfortable", measured);
  assert.ok(rows.every((row) => row.pass), table(rows));
  const drifted = compare(fixture, "windows", "large", "comfortable", { ...measured, rRow: 4.1 });
  assert.deepEqual(drifted.filter((row) => !row.pass).map((row) => row.name), ["row radius"]);
});

test("drift, a missing element and Larger text scaling are reported", () => {
  const rows = compare(spec, "windows", "normal", "comfortable", { ...onSpec, footer: 52, rTile: Number.NaN });
  assert.deepEqual(rows.filter((row) => !row.pass).map((row) => row.name), ["footer height", "tile radius"]);
  assert.match(table(rows), /tile radius +windows +normal +4 +— +MISMATCH/);
  const large = compare(spec, "macos", "large", "compact", { rowHeight: 46 });
  assert.deepEqual(large.map((row) => [row.name, row.pass]), [["row height (compact)", true]]);
});

const region = (name, top, bottom) => ({ name, top, bottom, left: 0, right: 720 });
const chips = (top, count) => Array.from({ length: count }, (_, i) => ({ top: top + i * 34, bottom: top + i * 34 + 28 }));

test("separate regions and a tray of whole chips pass the layout checks", () => {
  const rows = layout("macos", "normal", "tray-preview", {
    regions: [region("search-bar", 0, 56), region("Selected references", 56, 131), region("Preview", 131, 227), region("results-area", 227, 440), region("footer", 440, 480)],
    tray: { clip: { top: 56, bottom: 130 }, chips: chips(62, 50) },
    list: { ownScroll: true },
  });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.pass), table(rows));
  // Side by side is not an overlap.
  const beside = layout("linux", "normal", "pinned", { regions: [{ ...region("a", 0, 40), right: 300 }, { ...region("b", 0, 40), left: 300 }], tray: null, list: { ownScroll: true } });
  assert.ok(beside.every((row) => row.pass), table(beside));
});

test("overlapping regions, a half chip and a list without its own scroll fail (#746)", () => {
  const rows = layout("windows", "normal", "tray-preview", {
    regions: [region("Selected references", 56, 152), region("Preview", 150, 246), region("results-area", 240, 440)],
    tray: { clip: { top: 56, bottom: 151 }, chips: chips(62, 50) },
    list: { ownScroll: false },
  });
  assert.deepEqual(rows.filter((row) => !row.pass).map((row) => row.name), [
    "no regions overlap: Selected references/Preview, Preview/results-area (tray-preview)",
    "no chip cut by the tray edge (tray-preview)", "the list scrolls in its own area (tray-preview)"]);
  assert.equal(rows[0].measured, 2);
  // Without a tray only regions and the list are checked, and a missing list fails.
  assert.deepEqual(layout("linux", "large", "many-results", { regions: [], tray: null, list: null }).map((row) => row.pass), [true, false]);
});


test("RAC chip measurement includes inline items and the disclosure, including count-only clipping", () => {
  const priorDocument = globalThis.document, priorStyle = globalThis.getComputedStyle;
  let countOnly = false, invalid = false;
  const bounds = (top, bottom) => ({ top, bottom, left: 12, right: 708 });
  const items = [bounds(106, 130), bounds(106, 130)].map((rect) => ({
    hasAttribute: (name) => name === "data-chip-item", getBoundingClientRect: () => rect,
  }));
  const trigger = { getBoundingClientRect: () => ({ ...bounds(106, 144), left: invalid ? NaN : 500 }) };
  const strip = {
    getBoundingClientRect: () => bounds(100, 140),
    querySelectorAll: (selector) => [
      ...(!countOnly && selector.includes("data-chip-item") ? items : []),
      ...(selector.includes("data-chip-disclosure") ? [trigger] : []),
    ],
  };
  globalThis.document = {
    querySelectorAll: () => [],
    querySelector: (selector) => selector === ".shelf-chips" ? strip
      : selector === ".results-area" ? {} : null,
  };
  globalThis.getComputedStyle = () => ({ borderTopWidth: "1px", borderBottomWidth: "1px", overflowY: "auto" });
  try {
    for (countOnly of [false, true]) {
      const measured = measureLayout();
      assert.ok(measured.tray, "a count-only tray is still measured");
      assert.equal(measured.tray.chips.length, countOnly ? 1 : 3);
      const rows = layout("linux", "normal", "tray", measured);
      assert.equal(rows.find((row) => row.name.startsWith("no chip cut")).pass, false,
        "the partially clipped disclosure must fail even without inline chips");
    }
    invalid = true;
    assert.throws(() => measureLayout(), /finite/, "invalid target geometry cannot silently pass");
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    if (priorStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = priorStyle;
  }
});
