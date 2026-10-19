// JXA adapter for the real, process-owned NSOpenPanel. It never fills files
// through AX: the checker uses native keyboard input and an owned clipboard.
function unique(items) {
    if (items.length > 1) throw Error('Native dialog target is ambiguous');
    return items.length === 1 ? items[0] : null;
}
function flags(visible, foreground) {
    if (typeof visible !== 'boolean' || typeof foreground !== 'boolean') throw Error('Native state must be boolean');
    if (!visible && foreground) throw Error('Native dialog state is inconsistent');
    return {visible, foreground, owned: visible};
}
function locationFlags(ready, owned) {
    if (typeof ready !== 'boolean' || typeof owned !== 'boolean') throw Error('Native state must be boolean');
    if (ready && !owned) throw Error('Native location state is inconsistent');
    return {ready, owned};
}
if (typeof module !== 'undefined') module.exports = {unique, flags, locationFlags};

function run(argv) {
    ObjC.import('AppKit');
    ObjC.import('ApplicationServices');
    ObjC.import('CoreGraphics');
    ObjC.import('CoreFoundation');
    const stage = name => $.NSFileHandle.fileHandleWithStandardError.writeData(
        $('NATIVE CHOOSER MACOS ' + JSON.stringify({stage: name}) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    stage('identity');
    const action = argv[0], appId = Number(argv[1]);
    if (!Number.isInteger(appId) || appId <= 0) throw Error('Native app identity unavailable');
    if (!['state', 'location-state', 'cancel', 'confirm'].includes(action)) throw Error('Unsupported native dialog action');
    if (!$.AXIsProcessTrusted()) throw Error('Native dialog accessibility unavailable');
    const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(appId);
    if (!running || running.terminated) throw Error('Native app process unavailable');
    const events = Application('System Events');
    const processes = events.applicationProcesses.whose({unixId: appId})();
    if (processes.length !== 1) throw Error('Native app process unavailable');
    const app = processes[0];
    const read = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };
    const title = 'Choose a BibTeX or BibLaTeX library';
    const labelled = (node, name) => ['name', 'title', 'description', 'value']
        .some(property => read(() => node[property](), '') === name);
    // Windows have titles, not editable values. Do not ask an unrelated or
    // closing native window for an AXValue while discovering the dialog.
    const titled = node => ['name', 'title', 'description']
        .some(property => read(() => node[property](), '') === title);
    const focused = node => read(() => node.attributes.byName('AXFocused').value(), false) === true;
    const role = node => read(() => node.role(), '');
    const contents = node => {
        const nodes = node.entireContents();
        if (!Array.isArray(nodes) || nodes.length > 4000) throw Error('Native dialog traversal exceeded bound');
        return [node].concat(nodes);
    };
    const sheets = node => {
        const result = node.sheets();
        if (!Array.isArray(result) || result.length > 20) throw Error('Native sheet enumeration exceeded bound');
        if (result.some(sheet => role(sheet) !== 'AXSheet')) throw Error('Native path sheet role unavailable');
        return result;
    };
    const numeric = value => typeof value === 'number' && Number.isFinite(value);
    stage('scope');
    stage('windows');
    const windows = app.windows();
    if (windows.length > 20) throw Error('Native app window enumeration exceeded bound');
    stage('metadata');
    const refs = $.CGWindowListCopyWindowInfo(
        $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
    if (!refs) throw Error('Native on-screen window metadata unavailable');
    const count = Number($.CFArrayGetCount(refs));
    if (!Number.isInteger(count) || count < 0 || count > 10000) throw Error('Native window enumeration exceeded bound');
    const owned = [];
    for (let index = 0; index < count; index++) {
        const ref = $.CFArrayGetValueAtIndex(refs, index);
        if (!ref) throw Error('Native window metadata unavailable');
        const window = ObjC.deepUnwrap(ObjC.castRefToObject(ref));
        if (!window || typeof window !== 'object' || Array.isArray(window) || !numeric(window.kCGWindowOwnerPID)) {
            throw Error('Native window ownership metadata unavailable');
        }
        if (window.kCGWindowOwnerPID === appId) owned.push(window);
    }
    const onScreen = window => {
        stage('bounds');
        const position = window.position(), size = window.size();
        if (position.length !== 2 || size.length !== 2 || !position.concat(size).every(numeric)) {
            throw Error('Native accessible window bounds unavailable');
        }
        return owned.some(candidate => {
            const bounds = candidate.kCGWindowBounds;
            if (!bounds || !['X', 'Y', 'Width', 'Height'].every(key => numeric(bounds[key])) || !numeric(candidate.kCGWindowAlpha)) {
                throw Error('Native on-screen window bounds unavailable');
            }
            return candidate.kCGWindowAlpha > 0 && bounds.Width > 0 && bounds.Height > 0 &&
                Math.abs(position[0] - bounds.X) <= 2 && Math.abs(position[1] - bounds.Y) <= 2 &&
                Math.abs(size[0] - bounds.Width) <= 2 && Math.abs(size[1] - bounds.Height) <= 2;
        });
    };
    // A panel may be a titled top-level AXWindow or an AXSheet attached to
    // an owned window. Choose one representation, never its ancestor too.
    stage('candidates');
    const direct = windows.filter(window => titled(window) && onScreen(window));
    const candidates = direct.map(window => ({element: window}));
    if (candidates.length === 0) {
        stage('sheets');
        windows.filter(onScreen).forEach(window => {
            sheets(window).forEach(sheet => {
                if (titled(sheet)) candidates.push({element: sheet});
                else {
                    const nodes = contents(sheet);
                    if (nodes.some(node => labelled(node, title))) candidates.push({element: sheet, nodes});
                }
            });
        });
    }
    const dialog = unique(candidates);
    const frontmost = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    const appForeground = !!frontmost && Number(frontmost.processIdentifier) === appId;
    if (action === 'location-state') {
        stage('location');
        if (!dialog) return JSON.stringify(locationFlags(false, false));
        // Cmd-Shift-G opens a nested sheet. A focused text/combo field in
        // that sheet proves keyboard input will reach the path control. Read
        // the fresh sheet collection directly: enumerating every file-browser
        // descendant after Return can exceed the helper's deadline even when
        // the path sheet has already closed.
        const fields = [];
        sheets(dialog.element).forEach(sheet => {
            contents(sheet).filter(node => ['AXTextField', 'AXComboBox'].includes(role(node)) && focused(node))
                .forEach(node => fields.push(node));
        });
        const field = unique(fields);
        return JSON.stringify(locationFlags(!!field && appForeground, true));
    }
    stage('controls');
    if (dialog && !dialog.nodes) dialog.nodes = contents(dialog.element);
    const foreground = !!dialog && appForeground && dialog.nodes.some(focused);
    if (action === 'state') return JSON.stringify(flags(!!dialog, foreground));
    if (!dialog || !foreground) throw Error('Owned native chooser is not foreground');
    const label = action === 'cancel' ? 'Cancel' : 'Open';
    const button = unique(dialog.nodes.filter(node => role(node) === 'AXButton' && labelled(node, label)));
    if (!button) throw Error('Native dialog control unavailable');
    // Exactly one invocation. An AX error must never trigger a second action.
    stage('invoke');
    try { button.actions.byName('AXPress').perform(); }
    catch (_) { throw Error('Native dialog action failed'); }
    return JSON.stringify({invoked: true});
}
