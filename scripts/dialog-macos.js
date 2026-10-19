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
function exactKeys(value, keys) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
}
function positiveId(value) { return Number.isInteger(value) && value > 0 && value <= 0xffffffff; }
function validBounds(bounds) {
    return exactKeys(bounds, ['X', 'Y', 'Width', 'Height']) &&
        Object.values(bounds).every(value => typeof value === 'number' && Number.isFinite(value)) &&
        bounds.Width > 0 && bounds.Height > 0 && bounds.Width <= 8192 && bounds.Height <= 8192;
}
function validateToken(token, pid) {
    if (!exactKeys(token, ['owner', 'panel', 'sheet']) || !exactKeys(token.owner, ['pid', 'started']) ||
        !positiveId(token.owner.pid) || token.owner.pid !== pid ||
        typeof token.owner.started !== 'number' || !Number.isFinite(token.owner.started) || token.owner.started <= 0 ||
        ![token.panel, token.sheet].every(part => exactKeys(part, ['window', 'bounds']) && positiveId(part.window) && validBounds(part.bounds)) ||
        token.panel.window === token.sheet.window) throw Error('Native dialog identity metadata unavailable');
    return token;
}
function locationProgress(windows, token, foreground) {
    validateToken(token, token && token.owner && token.owner.pid);
    if (!Array.isArray(windows) || windows.length > 10000 || typeof foreground !== 'boolean') {
        throw Error('Native current window metadata unavailable');
    }
    for (const window of windows) {
        if (!window || !positiveId(window.kCGWindowNumber) || !Number.isInteger(window.kCGWindowOwnerPID) || window.kCGWindowOwnerPID < 0) {
            throw Error('Native current window identity unavailable');
        }
        if (window.kCGWindowOwnerPID === token.owner.pid &&
            (!validBounds(window.kCGWindowBounds) || typeof window.kCGWindowAlpha !== 'number' ||
                !Number.isFinite(window.kCGWindowAlpha) || window.kCGWindowAlpha < 0 || window.kCGWindowAlpha > 1)) {
            throw Error('Native owned window surface metadata unavailable');
        }
    }
    const byId = id => unique(windows.filter(window => window.kCGWindowNumber === id));
    const panel = byId(token.panel.window), sheet = byId(token.sheet.window);
    for (const window of [panel, sheet].filter(Boolean)) {
        if (window.kCGWindowOwnerPID !== token.owner.pid) throw Error('Native dialog window ownership changed');
    }
    if (panel && (!validBounds(panel.kCGWindowBounds) ||
        Object.keys(token.panel.bounds).some(key => Math.abs(panel.kCGWindowBounds[key] - token.panel.bounds[key]) > 2))) {
        throw Error('Native dialog window frame changed');
    }
    if (sheet) return {ready: false, closed: false};
    if (!panel) return {ready: true, closed: true};
    const surfaces = windows.filter(window => window.kCGWindowOwnerPID === token.owner.pid &&
        typeof window.kCGWindowAlpha === 'number' && window.kCGWindowAlpha > 0 &&
        validBounds(window.kCGWindowBounds));
    // OnScreenOnly is ordered front to back. Refuse another owned surface
    // above the dialog rather than posting Return to an unknown modal.
    return {ready: foreground && surfaces.length > 0 && surfaces[0].kCGWindowNumber === token.panel.window,
        closed: false};
}
if (typeof module !== 'undefined') module.exports = {unique, flags, locationFlags, validateToken, locationProgress};

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
    if (!['state', 'location-state', 'location-identity', 'after-location', 'confirm-key', 'cancel', 'confirm'].includes(action)) throw Error('Unsupported native dialog action');
    if (!$.AXIsProcessTrusted()) throw Error('Native dialog accessibility unavailable');
    const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(appId);
    if (!running || running.isTerminated) throw Error('Native app process unavailable');
    const readWindows = () => {
        const refs = $.CGWindowListCopyWindowInfo(
            $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
        if (!refs) throw Error('Native on-screen window metadata unavailable');
        const count = Number($.CFArrayGetCount(refs));
        if (!Number.isInteger(count) || count < 0 || count > 10000) throw Error('Native window enumeration exceeded bound');
        const result = [];
        for (let index = 0; index < count; index++) {
            const ref = $.CFArrayGetValueAtIndex(refs, index);
            if (!ref) throw Error('Native window metadata unavailable');
            const window = ObjC.deepUnwrap(ObjC.castRefToObject(ref));
            if (!window || typeof window !== 'object' || Array.isArray(window) || !Number.isFinite(window.kCGWindowOwnerPID)) {
                throw Error('Native window ownership metadata unavailable');
            }
            result.push(window);
        }
        return result;
    };
    const started = () => Number(running.launchDate.timeIntervalSince1970);
    const appIsForeground = () => {
        const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
        return !!front && Number(front.processIdentifier) === appId;
    };
    if (action === 'after-location' || action === 'confirm-key') {
        if (typeof argv[2] !== 'string' || argv[2].length > 2048) throw Error('Native dialog identity metadata unavailable');
        const token = validateToken(JSON.parse(argv[2]), appId);
        const progress = () => {
            if (running.isTerminated || started() !== token.owner.started) throw Error('Native app process identity changed');
            return locationProgress(readWindows(), token, appIsForeground());
        };
        if (action === 'after-location') return JSON.stringify(progress());
        // Public HID events, with all preparation before the final ownership
        // check. No AX traversal after the nested path sheet closes.
        if (typeof $.CGPreflightPostEventAccess !== 'function') {
            try { ObjC.bindFunction('CGPreflightPostEventAccess', ['bool', []]); }
            catch (_) { throw Error('Native event-posting preflight unavailable'); }
        }
        if ($.CGPreflightPostEventAccess() !== true) throw Error('Native event posting unavailable');
        const source = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState);
        if (!source) throw Error('Native HID event source unavailable');
        const down = $.CGEventCreateKeyboardEvent(source, 36, true);
        const up = $.CGEventCreateKeyboardEvent(source, 36, false);
        if (!down || !up) throw Error('Native HID keyboard event unavailable');
        $.CGEventSetFlags(down, 0); $.CGEventSetFlags(up, 0);
        const current = progress();
        if (!current.ready || current.closed) throw Error('Owned native chooser is not ready for confirmation');
        stage('invoke');
        let failure;
        try { $.CGEventPost($.kCGHIDEventTap, down); } catch (error) { failure = error; }
        try { $.CGEventPost($.kCGHIDEventTap, up); } catch (error) { failure ||= error; }
        if (failure) throw Error('Native dialog keyboard action failed');
        return JSON.stringify({invoked: true});
    }
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
    const owned = readWindows().filter(window => window.kCGWindowOwnerPID === appId);
    const nativeFrame = window => {
        stage('bounds');
        const position = window.position(), size = window.size();
        if (position.length !== 2 || size.length !== 2 || !position.concat(size).every(numeric)) {
            throw Error('Native accessible window bounds unavailable');
        }
        return unique(owned.filter(candidate => {
            const bounds = candidate.kCGWindowBounds;
            if (!bounds || !['X', 'Y', 'Width', 'Height'].every(key => numeric(bounds[key])) || !numeric(candidate.kCGWindowAlpha)) {
                throw Error('Native on-screen window bounds unavailable');
            }
            return candidate.kCGWindowAlpha > 0 && bounds.Width > 0 && bounds.Height > 0 &&
                Math.abs(position[0] - bounds.X) <= 2 && Math.abs(position[1] - bounds.Y) <= 2 &&
                Math.abs(size[0] - bounds.Width) <= 2 && Math.abs(size[1] - bounds.Height) <= 2;
        }));
    };
    const onScreen = window => !!nativeFrame(window);
    // A panel may be a titled top-level AXWindow or an AXSheet attached to
    // an owned window. Choose one representation, never its ancestor too.
    stage('candidates');
    const direct = windows.filter(window => titled(window) && onScreen(window));
    const candidates = direct.map(window => ({element: window}));
    if (candidates.length === 0) {
        stage('sheets');
        // The attached sheet is the dialog's native surface. Its ancestor's
        // AX bounds can be unavailable while a modal child is open, and a
        // visible ancestor does not establish the sheet's on-screen identity.
        // Do not query unrelated picker bounds when no sheet exists.
        windows.forEach(window => {
            sheets(window).forEach(sheet => {
                if (titled(sheet)) {
                    if (onScreen(sheet)) candidates.push({element: sheet});
                }
                else {
                    const nodes = contents(sheet);
                    if (nodes.some(node => labelled(node, title)) && onScreen(sheet)) candidates.push({element: sheet, nodes});
                }
            });
        });
    }
    const dialog = unique(candidates);
    const appForeground = appIsForeground();
    if (action === 'location-state' || action === 'location-identity') {
        stage('location');
        if (!dialog) return JSON.stringify(action === 'location-state' ? locationFlags(false, false) : {ready: false, owned: false, token: null});
        // Cmd-Shift-G opens a nested sheet. A focused text/combo field in
        // that sheet proves keyboard input will reach the path control. Read
        // the fresh sheet collection directly: enumerating every file-browser
        // descendant after Return can exceed the helper's deadline even when
        // the path sheet has already closed.
        const fields = [];
        sheets(dialog.element).forEach(sheet => {
            contents(sheet).filter(node => ['AXTextField', 'AXComboBox'].includes(role(node)) && focused(node))
                .forEach(node => fields.push({node, sheet}));
        });
        const field = unique(fields);
        const ready = !!field && appForeground;
        if (action === 'location-state') return JSON.stringify(locationFlags(ready, true));
        if (!ready) return JSON.stringify({ready: false, owned: true, token: null});
        const part = element => {
            const row = nativeFrame(element);
            if (!row) throw Error('Native dialog physical window identity unavailable');
            return {window: row.kCGWindowNumber, bounds: row.kCGWindowBounds};
        };
        const token = validateToken({owner: {pid: appId, started: started()},
            panel: part(dialog.element), sheet: part(field.sheet)}, appId);
        return JSON.stringify({ready: true, owned: true, token});
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
