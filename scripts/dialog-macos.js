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
function positivePid(value) { return positiveId(value) && value <= 0x7fffffff; }
function validExecutable(value) {
    return typeof value === 'string' && value.startsWith('/') && value.length <= 1024 && !value.includes('\0');
}
function validBounds(bounds) {
    return exactKeys(bounds, ['X', 'Y', 'Width', 'Height']) &&
        Object.values(bounds).every(value => typeof value === 'number' && Number.isFinite(value)) &&
        bounds.Width > 0 && bounds.Height > 0 && bounds.Width <= 8192 && bounds.Height <= 8192;
}
function validateToken(token, pid, executable) {
    if (!exactKeys(token, ['owner', 'panel', 'sheet']) || !exactKeys(token.owner, ['pid', 'executable']) ||
        !positivePid(token.owner.pid) || token.owner.pid !== pid ||
        !validExecutable(token.owner.executable) || token.owner.executable !== executable ||
        !exactKeys(token.panel, ['window', 'bounds']) || !positiveId(token.panel.window) || !validBounds(token.panel.bounds) ||
        !exactKeys(token.sheet, ['bounds']) || !validBounds(token.sheet.bounds)) throw Error('Native dialog identity metadata unavailable');
    return token;
}
function locationProgress(windows, token, foreground) {
    validateToken(token, token && token.owner && token.owner.pid, token && token.owner && token.owner.executable);
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
    const panel = byId(token.panel.window);
    for (const window of [panel].filter(Boolean)) {
        if (window.kCGWindowOwnerPID !== token.owner.pid) throw Error('Native dialog window ownership changed');
    }
    if (panel && (!validBounds(panel.kCGWindowBounds) ||
        Object.keys(token.panel.bounds).some(key => Math.abs(panel.kCGWindowBounds[key] - token.panel.bounds[key]) > 2))) {
        throw Error('Native dialog window frame changed');
    }
    if (!panel) return {ready: true, closed: true};
    const surfaces = windows.filter(window => window.kCGWindowOwnerPID === token.owner.pid &&
        typeof window.kCGWindowAlpha === 'number' && window.kCGWindowAlpha > 0 &&
        validBounds(window.kCGWindowBounds));
    // OnScreenOnly is ordered front to back. Refuse another owned surface
    // above the dialog rather than posting Return to an unknown modal.
    return {ready: foreground && surfaces.length > 0 && surfaces[0].kCGWindowNumber === token.panel.window,
        closed: false};
}

// SDK: AXUIElement.h / AXValue.h and Apple's JXA explicit Ref bridge.
// AX CF types are CF_BRIDGED_TYPE(id); CFIndex is signed long on supported
// 64-bit macOS. CGPoint/CGSize Ref outputs use imported CoreGraphics layouts.
// https://developer.apple.com/documentation/applicationservices/1462085-axuielementcopyattributevalue
// https://developer.apple.com/documentation/applicationservices/1462933-axvaluegetvalue
// https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html
function boundedAX(api, bridge, reference, pid, clock, stage, diagnostic) {
    stage('scope');
    const bindings = {
        AXUIElementCreateSystemWide: ['id', []], AXUIElementCreateApplication: ['id', ['int']],
        AXUIElementGetTypeID: ['unsigned long', []], AXValueGetTypeID: ['unsigned long', []],
        AXUIElementSetMessagingTimeout: ['int', ['id', 'float']],
        AXUIElementGetPid: ['int', ['id', 'int*']],
        AXUIElementCopyAttributeValue: ['int', ['id', 'id', 'id*']],
        AXUIElementGetAttributeValueCount: ['int', ['id', 'id', 'long*']],
        AXUIElementCopyAttributeValues: ['int', ['id', 'id', 'long', 'long', 'id*']],
        AXValueGetType: ['unsigned int', ['id']], AXValueGetValue: ['unsigned char', ['id', 'unsigned int', 'void*']],
    };
    const allowedAPIs = Object.keys(bindings).concat(['CFGetTypeID', 'CFEqual', 'CFStringGetTypeID',
        'CFBooleanGetValue', 'CFBooleanGetTypeID', 'CFArrayGetTypeID', 'CFArrayGetCount',
        'CFArrayGetValueAtIndex', 'CGPointMake', 'CGSizeMake']);
    let lastAPI = 'AXUIElementCreateSystemWide', reported = false;
    const fail = (reason, message, origin = lastAPI) => {
        if (!reported) {
            reported = true;
            diagnostic(allowedAPIs.includes(origin) ? origin : 'CFGetTypeID', reason);
        }
        throw Error(message);
    };
    const available = name => {
        try { return typeof api[name] === 'function'; }
        catch (_) { return false; }
    };
    for (const name of Object.keys(bindings)) {
        if (!available(name)) {
            try { bridge.bindFunction(name, bindings[name]); }
            catch (_) { fail('bind-unavailable', 'Native AX public API unavailable', name); }
        }
        if (!available(name)) fail('bind-unavailable', 'Native AX public API unavailable', name);
    }
    const now = () => {
        let value;
        try { value = clock(); }
        catch (_) { fail('invalid-result', 'Native AX clock unavailable'); }
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('invalid-result', 'Native AX clock unavailable');
        return value;
    };
    const began = now();
    let calls = 0;
    const budget = () => {
        const elapsed = now() - began;
        if (elapsed < 0 || elapsed > 4000 || calls >= 256) fail('budget-exceeded', 'Native AX observation budget exceeded');
    };
    const call = (name, ...args) => {
        lastAPI = name;
        budget(); calls++;
        if (!available(name)) fail('bind-unavailable', 'Native AX public API unavailable');
        let value;
        try { value = api[name](...args); }
        catch (_) { fail('call-exception', 'Native AX public call failed'); }
        budget(); return value;
    };
    const success = value => {
        if (value !== 0) fail('ax-error', 'Native AX observation failed');
    };
    const typeID = (value, origin) => {
        // CFBase.h: CFTypeID is unsigned long on macOS (non-LLP64).
        // https://github.com/apple-oss-distributions/CF/blob/main/CFBase.h
        // Imported and explicitly bound functions
        // may expose its exact integer as a number or a canonical JXA string.
        if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
            fail('invalid-type-id', 'Native AX value type unavailable', origin);
        }
        return value;
    };
    const typed = (value, name) => {
        let present;
        try { present = !!value && ['object', 'function'].includes(typeof value) &&
            !(typeof value.isNil === 'function' && value.isNil()); }
        catch (_) { fail('invalid-result', 'Native AX reference unavailable', 'CFGetTypeID'); }
        if (!present) {
            fail('missing-reference', 'Native AX value type unavailable', 'CFGetTypeID');
        }
        const actual = typeID(call('CFGetTypeID', value), 'CFGetTypeID');
        const expected = typeID(call(name), name);
        if (actual !== expected) fail('type-mismatch', 'Native AX value type unavailable', 'CFGetTypeID');
        return value;
    };
    const element = value => {
        typed(value, 'AXUIElementGetTypeID');
        const out = reference();
        success(call('AXUIElementGetPid', value, out));
        if (!Number.isInteger(out[0]) || out[0] !== pid) fail('owner-mismatch', 'Native AX element ownership changed');
        return value;
    };
    // SDK Boolean is uint8, while the imported bridge may expose bool.
    // Accept precisely either representation, never arbitrary truthy values.
    const cBoolean = value => {
        if (value === true || value === 1) return true;
        if (value === false || value === 0) return false;
        fail('invalid-result', 'Native AX boolean unavailable');
    };
    const same = (left, right) => cBoolean(call('CFEqual', left, right));
    const read = (value, name, optionalLabel = false) => {
        element(value);
        const out = reference();
        const error = call('AXUIElementCopyAttributeValue', value, api(name), out);
        // Optional alternate labels are not proof of absence or closure.
        if (optionalLabel && (error === -25205 || error === -25212)) return null;
        success(error);
        return out[0];
    };
    const text = (value, name, optionalLabel = false) => {
        const result = read(value, name, optionalLabel);
        if (result === null) return null;
        const unwrapped = bridge.unwrap(typed(result, 'CFStringGetTypeID'));
        if (typeof unwrapped !== 'string') fail('invalid-result', 'Native AX string unavailable');
        return unwrapped;
    };
    const boolean = (value, name) => {
        return cBoolean(call('CFBooleanGetValue', typed(read(value, name), 'CFBooleanGetTypeID')));
    };
    const index = value => {
        // Apple's JXA Data Types notes specify long values may be strings.
        if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('invalid-result', 'Native AX array count unavailable');
        return value;
    };
    const children = (value, name, limit) => {
        element(value);
        const countRef = reference();
        success(call('AXUIElementGetAttributeValueCount', value, api(name), countRef));
        const count = index(countRef[0]);
        if (count > limit) fail('invalid-result', 'Native AX array bound exceeded');
        if (count === 0) return []; // Successful count, not an AX error.
        const out = reference();
        success(call('AXUIElementCopyAttributeValues', value, api(name), 0, limit + 1, out));
        typed(out[0], 'CFArrayGetTypeID');
        const size = index(call('CFArrayGetCount', out[0]));
        if (size !== count || size > limit) fail('invalid-result', 'Native AX array bound changed');
        const result = [];
        for (let index = 0; index < size; index++) {
            result.push(element(bridge.castRefToObject(call('CFArrayGetValueAtIndex', out[0], index))));
        }
        return result;
    };
    const role = value => text(value, 'AXRole');
    const frame = value => {
        stage('bounds');
        const decode = (name, kind, type) => {
            const encoded = typed(read(value, name), 'AXValueGetTypeID');
            if (call('AXValueGetType', encoded) !== kind) fail('invalid-result', 'Native AX geometry type unavailable');
            // Ref's argument is a bridge type name, not an initial value.
            // Initialize that imported struct explicitly before its void* use.
            const out = reference(type);
            out[0] = call(kind === 1 ? 'CGPointMake' : 'CGSizeMake', 0, 0);
            if (!cBoolean(call('AXValueGetValue', encoded, kind, out))) fail('invalid-result', 'Native AX geometry unavailable');
            return out[0];
        };
        const point = decode('AXPosition', 1, 'CGPoint'), size = decode('AXSize', 2, 'CGSize');
        const result = {X: point && point.x, Y: point && point.y, Width: size && size.width, Height: size && size.height};
        if (!validBounds(result)) fail('invalid-result', 'Native AX frame metadata unavailable');
        return result;
    };
    const system = typed(call('AXUIElementCreateSystemWide'), 'AXUIElementGetTypeID');
    // AXUIElement.h: only the system-wide object changes this process's default
    // for newly obtained refs. Setting app alone does not cover derived refs.
    success(call('AXUIElementSetMessagingTimeout', system, 0.25));
    const app = element(call('AXUIElementCreateApplication', pid));
    const title = 'Choose a BibTeX or BibLaTeX library';
    const titled = value => text(value, 'AXTitle', true) === title || text(value, 'AXDescription', true) === title;
    // AXAttributeConstants.h exposes AXChildren, not an AXSheets attribute.
    // Inspect only direct children; never enumerate the file browser subtree.
    const sheets = value => {
        stage('sheets');
        return children(value, 'AXChildren', 32).filter(child => role(child) === 'AXSheet');
    };
    const panels = () => {
        stage('windows');
        const windows = children(app, 'AXWindows', 20);
        stage('candidates');
        const result = [];
        const add = value => {
            if (!result.some(existing => same(existing, value))) result.push(value);
        };
        for (const window of windows) {
            if (!['AXWindow', 'AXSheet'].includes(role(window))) fail('invalid-result', 'Native AX window role unavailable');
            if (titled(window)) add(window);
            else for (const sheet of sheets(window)) if (titled(sheet)) add(sheet);
        }
        return result;
    };
    const ancestry = (value, panel) => {
        const chain = [];
        for (let depth = 0; depth < 16; depth++) {
            element(value);
            if (chain.some(previous => same(previous, value))) fail('invalid-result', 'Native AX ancestry is cyclic');
            chain.push(value);
            if (same(value, panel)) return chain;
            value = element(read(value, 'AXParent'));
        }
        fail('invalid-result', 'Native AX ancestry exceeded bound');
    };
    const focus = panel => {
        const value = element(read(app, 'AXFocusedUIElement'));
        return {value, chain: ancestry(value, panel)};
    };
    return {panels, frame,
        location(panel) {
            stage('location');
            const attached = sheets(panel);
            const sheet = unique(attached);
            if (!sheet) return null;
            if (!same(element(read(sheet, 'AXParent')), panel)) fail('owner-mismatch', 'Native AX sheet parent changed');
            const current = focus(panel);
            if (!['AXTextField', 'AXComboBox'].includes(role(current.value)) || !boolean(current.value, 'AXFocused')) return null;
            if (!current.chain.some(value => same(value, sheet))) return null;
            return frame(sheet);
        },
        ready(panel) {
            if (sheets(panel).length !== 0) return false;
            focus(panel); // Positive successful ancestry, never unsupported-as-empty.
            stage('controls');
            const button = element(read(panel, 'AXDefaultButton'));
            if (role(button) !== 'AXButton' || text(button, 'AXTitle') !== 'Open') fail('invalid-result', 'Native AX default Open unavailable');
            ancestry(button, panel);
            const enabled = boolean(button, 'AXEnabled');
            return enabled && sheets(panel).length === 0;
        },
    };
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
    const action = argv[0], appId = Number(argv[1]), executable = argv[2];
    if (!positivePid(appId) || !validExecutable(executable)) throw Error('Native app identity unavailable');
    if (!['state', 'location-state', 'location-identity', 'after-location', 'confirm-key', 'cancel', 'confirm'].includes(action)) throw Error('Unsupported native dialog action');
    if (!$.AXIsProcessTrusted()) throw Error('Native dialog accessibility unavailable');
    // The Python owner holds the unreaped Popen child and checks poll()
    // before and after every call. Its PID cannot be reused during that life.
    // NSRunningApplication.launchDate is unavailable outside Launch Services.
    const checkOwner = (allowUnavailable = false) => {
        const unavailable = () => {
            if (allowUnavailable) return false;
            throw Error('Native app process metadata unavailable');
        };
        let current, pid, terminated, url, path, fileURL;
        try {
            current = $.NSRunningApplication.runningApplicationWithProcessIdentifier(appId);
            if (!current || (typeof current.isNil === 'function' && current.isNil())) return unavailable();
            pid = current.processIdentifier; terminated = current.isTerminated;
        } catch (_) { return unavailable(); }
        if (pid === undefined || pid === null || terminated === undefined || terminated === null) return unavailable();
        if (!positivePid(pid) || typeof terminated !== 'boolean' || pid !== appId || terminated) throw Error('Native app process identity changed');
        try {
            url = current.executableURL;
            if (!url || (typeof url.isNil === 'function' && url.isNil())) return unavailable();
            fileURL = url.isFileURL;
            path = ObjC.unwrap(url.path);
        } catch (_) { return unavailable(); }
        if (path === undefined || path === null || path === '' || fileURL === undefined || fileURL === null) return unavailable();
        if (fileURL !== true || !validExecutable(path) || path !== executable) throw Error('Native app process identity changed');
        return true;
    };
    if (!checkOwner(action === 'location-identity')) return JSON.stringify({ready: false, owned: false, token: null});
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
    const appIsForeground = () => {
        const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
        return !!front && Number(front.processIdentifier) === appId;
    };
    const diagnostic = (api, reason) => $.NSFileHandle.fileHandleWithStandardError.writeData(
        $('NATIVE CHOOSER MACOS AX ' + JSON.stringify({api, reason}) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    const ax = () => boundedAX($, ObjC, Ref, appId, () => Number($.NSProcessInfo.processInfo.systemUptime) * 1000, stage, diagnostic);
    const panelForAX = (observations, windows, token) => {
        const matching = [];
        for (const element of observations.panels()) {
            const bounds = observations.frame(element);
            const native = unique(windows.filter(window => window.kCGWindowOwnerPID === appId &&
                window.kCGWindowAlpha > 0 && validBounds(window.kCGWindowBounds) &&
                Object.keys(bounds).every(key => Math.abs(bounds[key] - window.kCGWindowBounds[key]) <= 2)));
            if (native && (!token || native.kCGWindowNumber === token.panel.window)) matching.push({element, native});
        }
        return unique(matching);
    };
    if (action === 'location-identity') {
        const owner = {pid: appId, executable};
        const observations = ax();
        const panel = panelForAX(observations, readWindows());
        if (!panel) return JSON.stringify({ready: false, owned: false, token: null});
        if (!appIsForeground()) return JSON.stringify({ready: false, owned: true, token: null});
        const bounds = observations.location(panel.element);
        if (!bounds) return JSON.stringify({ready: false, owned: true, token: null});
        const token = validateToken({owner, panel: {window: panel.native.kCGWindowNumber, bounds: panel.native.kCGWindowBounds},
            sheet: {bounds}}, appId, executable);
        // The nested logical sheet may share the physical panel surface or
        // have its own. Refresh panel identity without inventing a sheet ID.
        const windows = readWindows();
        const foreground = appIsForeground();
        const current = locationProgress(windows, token, foreground);
        checkOwner();
        const visible = !current.closed && windows.some(window =>
            window.kCGWindowNumber === token.panel.window && window.kCGWindowAlpha > 0);
        if (!foreground || !visible) return JSON.stringify({ready: false, owned: visible, token: null});
        return JSON.stringify({ready: true, owned: true, token});
    }
    if (action === 'after-location' || action === 'confirm-key') {
        if (typeof argv[3] !== 'string' || argv[3].length > 2048) throw Error('Native dialog identity metadata unavailable');
        const token = validateToken(JSON.parse(argv[3]), appId, executable);
        const progress = () => {
            checkOwner();
            const windows = readWindows();
            const current = locationProgress(windows, token, appIsForeground());
            if (current.closed || !current.ready) return current;
            const observations = ax();
            const panel = panelForAX(observations, windows, token);
            if (!panel) throw Error('Native AX owned panel unavailable');
            const ready = observations.ready(panel.element);
            // AX calls are bounded but may take time. Do not post using CG or
            // foreground facts captured before those messages were sent.
            const latest = locationProgress(readWindows(), token, appIsForeground());
            checkOwner();
            return latest.closed ? latest : {ready: ready && latest.ready, closed: false};
        };
        if (action === 'after-location') return JSON.stringify(progress());
        // Public HID events are prepared before the final bounded C AX/CG proof.
        // System Events is never used on this post-path observation/action route.
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
                .forEach(node => fields.push({node, sheet}));
        });
        const field = unique(fields);
        const ready = !!field && appForeground;
        return JSON.stringify(locationFlags(ready, true));
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
    checkOwner();
    if (!appIsForeground()) throw Error('Owned native chooser is not foreground');
    stage('invoke');
    try { button.actions.byName('AXPress').perform(); }
    catch (_) { throw Error('Native dialog action failed'); }
    return JSON.stringify({invoked: true});
}
