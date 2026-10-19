"""Owned GTK chooser actions for the native lifecycle check; no app IPC."""
import subprocess
import time

TITLE = "Choose a BibTeX or BibLaTeX library"


def owned_candidate(candidates, app_pid):
    if not candidates:
        return None
    if len(candidates) != 1 or candidates[0][1:] != (app_pid, TITLE):
        raise AssertionError("Native chooser identity is ambiguous or unowned")
    return candidates[0][0]


def row_target(nodes, filename, showing):
    matches = [item for item in nodes if item.getRoleName() == "table cell" and item.name == filename
               and item.getState().contains(showing)]
    if len(matches) > 1:
        raise AssertionError("Synthetic native filename is ambiguous")
    if not matches:
        return None
    cell = matches[0]
    # GTK may nest a text renderer cell inside a container cell. Keep every
    # ancestor inside the already-owned dialog tree and bound malformed cycles.
    for _ in range(16):
        parent = cell.parent
        if parent is None or parent not in nodes:
            raise AssertionError("Native filename ancestry is outside the owned dialog")
        role = parent.getRoleName()
        if role in ("table", "tree table"):
            table = parent.queryTable()
            row = table.getRowAtIndex(cell.getIndexInParent())
            if row < 0 or row >= table.nRows:
                raise AssertionError("Native filename row is unavailable")
            return table, row
        if role != "table cell":
            break
        cell = parent
    raise AssertionError("Native filename is not in an owned file table")


def select_exact_row(table, row):
    if list(table.getSelectedRows()) == [row]:
        return
    # GTK returns false for an already-selected row. A concurrent native
    # selection update is acceptable only when the exact target is confirmed.
    if not table.addRowSelection(row) and list(table.getSelectedRows()) != [row]:
        raise AssertionError("Native file table rejected the synthetic row selection")


class Dialog:
    def __init__(self, native, run):
        self.native, self.run = native, run
        self.picker = native.window(native.app.pid)
        if not self.picker or self.run("xdotool", "getwindowpid", self.picker) != str(native.app.pid):
            raise AssertionError("Initial picker window ownership unavailable")

    def picker_visible(self):
        try:
            windows = self.run("xdotool", "search", "--onlyvisible", "--pid", str(self.native.app.pid)).splitlines()
        except subprocess.CalledProcessError as error:
            if error.returncode == 1:
                return False
            raise
        return self.picker in windows and self.run("xdotool", "getwindowpid", self.picker) == str(self.native.app.pid)

    def _window(self):
        try:
            ids = self.run("xdotool", "search", "--all", "--onlyvisible", "--pid", str(self.native.app.pid),
                           "--name", "^" + TITLE + "$").splitlines()
        except subprocess.CalledProcessError as error:
            if error.returncode == 1:
                ids = []
            else:
                raise
        if len(ids) > 20:
            raise AssertionError("Native chooser enumeration exceeded bound")
        candidates = [(int(window), int(self.run("xdotool", "getwindowpid", window)),
                       self.run("xdotool", "getwindowname", window)) for window in ids]
        return owned_candidate(candidates, self.native.app.pid)

    def state(self):
        window = self._window()
        return {"visible": window is not None, "foreground": window is not None and
                self.run("xdotool", "getactivewindow") == str(window) and
                self.run("xdotool", "getwindowfocus") == str(window), "owned": window is not None}

    def _nodes(self):
        if not all(self.state().values()):
            raise AssertionError("Native chooser is not owned and foreground")
        desktop = self.native.atspi.Registry.getDesktop(0)
        stack = [app for app in desktop if app and app.get_process_id() == self.native.app.pid]
        for app in stack:
            app.clearCache()
        matches, count = [], 0
        while stack:
            item = stack.pop()
            count += 1
            if count > 4000:
                raise AssertionError("Native chooser accessibility traversal exceeded bound")
            if item.name == TITLE and item.getRoleName() in ("dialog", "file chooser", "frame", "window"):
                matches.append(item)
            stack.extend(child for child in item if child)
        if len(matches) != 1:
            raise AssertionError("Native chooser accessibility identity unavailable")
        stack, nodes = [matches[0]], []
        while stack:
            item = stack.pop()
            nodes.append(item)
            if len(nodes) > 4000:
                raise AssertionError("Native chooser control traversal exceeded bound")
            stack.extend(child for child in item if child)
        return nodes

    def location_controls_ready(self):
        nodes = self._nodes()
        actions = [item for item in nodes if item.name in ("Open", "_Open", "Cancel", "_Cancel")
                   and item.getState().contains(self.native.atspi.STATE_SHOWING)]
        busy = any(item.getState().contains(self.native.atspi.STATE_BUSY) for item in nodes)
        focused = any(item.getState().contains(self.native.atspi.STATE_FOCUSED) for item in nodes)
        active = nodes[0].getState().contains(self.native.atspi.STATE_ACTIVE)
        return len(actions) == 2 and not busy and focused and active

    def location_state(self):
        state = self.state()
        if not all(state.values()):
            return {"ready": False, "owned": state["owned"]}
        nodes = self._nodes()
        entries = [item for item in nodes if item.getRoleName() in ("text", "entry", "combo box")
                   and item.getState().contains(self.native.atspi.STATE_FOCUSED)]
        if len(entries) > 1:
            raise AssertionError("Native chooser location focus is ambiguous")
        return {"ready": len(entries) == 1, "owned": True}

    def select_path(self, path):
        # The disposable GTK session opens this check's synthetic working
        # directory. Select the exact visible filename through native AT-SPI.
        deadline = time.monotonic() + 20
        target = None
        while target is None:
            target = row_target(self._nodes(), path.name, self.native.atspi.STATE_SHOWING)
            if time.monotonic() >= deadline:
                raise AssertionError("Owned synthetic filename was not visible")
            if target is None:
                time.sleep(0.1)
        table, row = target
        state = self.state()
        if not all(state.values()):
            print("NATIVE CHOOSER OWNERSHIP " + __import__("json").dumps(state), flush=True)
            raise AssertionError("Native chooser lost foreground before selection")
        select_exact_row(table, row)
        while list(table.getSelectedRows()) != [row]:
            if time.monotonic() >= deadline:
                raise AssertionError("Owned synthetic file selection was not confirmed")
            time.sleep(0.1)
        self.confirm()

    def cancel(self):
        if not all(self.state().values()):
            raise AssertionError("Cannot cancel an unowned chooser")
        self.native.key("Escape")

    def confirm(self):
        deadline = time.monotonic() + 10
        while True:
            nodes = self._nodes()
            buttons = [item for item in nodes if item.getRoleName() in ("button", "push button")
                       and item.name in ("Open", "_Open")
                       and item.getState().contains(self.native.atspi.STATE_SHOWING)]
            if len(buttons) > 1:
                raise AssertionError("Native Open action is ambiguous")
            if len(buttons) == 1 and buttons[0].getState().contains(self.native.atspi.STATE_ENABLED):
                if not buttons[0].queryAction().doAction(0):
                    raise AssertionError("Exact native Open action failed")
                return
            if time.monotonic() >= deadline:
                raise AssertionError("Exact native Open action unavailable")
            time.sleep(0.1)
