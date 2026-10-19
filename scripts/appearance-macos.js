// Ordinary Accessibility UI only. Never write preferences or request TCC grants.
ObjC.import('AppKit');
ObjC.import('ApplicationServices');

function run(argv) {
    const action = argv[0], identity = argv[1], argument = argv[2];
    const bundle = 'com.apple.systempreferences';
    const events = Application('System Events');
    const safe = fn => { try { return fn(); } catch (_) { return undefined; } };
    const running = () => $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundle);
    const owner = () => {
        const apps = running();
        if (Number(apps.count) === 0) return '';
        if (Number(apps.count) !== 1) throw Error('System Settings process identity is ambiguous');
        const app = apps.objectAtIndex(0);
        return JSON.stringify({pid: Number(app.processIdentifier), started: Number(app.launchDate.timeIntervalSince1970)});
    };
    const owned = () => {
        const token = JSON.parse(identity);
        if (!Number.isInteger(token.pid) || token.pid <= 0 || !Number.isFinite(token.started) || token.started <= 0) {
            throw Error('Owned System Settings identity unavailable');
        }
        const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(token.pid);
        if (!app || ObjC.unwrap(app.bundleIdentifier) !== bundle || Number(app.launchDate.timeIntervalSince1970) !== token.started) {
            throw Error('Owned System Settings identity changed');
        }
        return {app, process: events.applicationProcesses.whose({unixId: token.pid})()[0]};
    };
    const controls = () => {
        const windows = owned().process.windows();
        if (windows.length > 10) throw Error('System Settings window traversal exceeded bound');
        const labels = {contrast: 'Increase contrast', transparency: 'Reduce transparency'};
        const trees = new Map();
        const tree = index => {
            if (!trees.has(index)) trees.set(index, windows[index].entireContents());
            if ([...trees.values()].reduce((sum, nodes) => sum + nodes.length, 0) > 6000) {
                throw Error('System Settings control traversal exceeded bound');
            }
            return trees.get(index);
        };
        const exact = (node, key) => node && safe(() => node.role()) === 'AXCheckBox' &&
            [safe(() => node.title()), safe(() => node.description()), safe(() => node.name())].includes(labels[key]);
        const cached = JSON.parse(identity).controls;
        const result = {refs: {}, paths: {window_count: windows.length}};
        if (cached && cached.window_count === windows.length && Object.keys(labels).every(key => {
            const position = cached[key];
            if (!position || !['window', 'index', 'tree_count'].every(field => Number.isInteger(position[field])) ||
                position.window < 0 || position.window >= windows.length || position.index < 0) return false;
            const nodes = tree(position.window);
            if (position.tree_count !== nodes.length || position.index >= nodes.length || !exact(nodes[position.index], key)) return false;
            result.refs[key] = nodes[position.index];
            return true;
        })) return {refs: result.refs, paths: cached};
        // A cached index is only a hint into a fresh bounded AX array. Changed
        // counts, ownership, role or fixed label invalidate it; rediscover once.
        result.refs = {};
        for (let window = 0; window < windows.length; window++) {
            const nodes = tree(window);
            nodes.forEach((node, index) => {
                if (safe(() => node.role()) !== 'AXCheckBox') return;
                const names = [safe(() => node.title()), safe(() => node.description()), safe(() => node.name())];
                for (const key of Object.keys(labels)) {
                    if (!names.includes(labels[key])) continue;
                    if (result.refs[key]) throw Error('Exact accessibility preference control is ambiguous');
                    result.refs[key] = node;
                    result.paths[key] = {window, index, tree_count: nodes.length};
                }
            });
        }
        return result;
    };
    const state = found => {
        const result = {};
        for (const key of ['contrast', 'transparency']) {
            if (!found[key]) throw Error('Exact accessibility preference control unavailable');
            const value = found[key].value();
            if (typeof value !== 'boolean' && value !== 0 && value !== 1) throw Error('Native preference value is not boolean');
            result[key] = value === true || value === 1;
        }
        return result;
    };
    let result;
    switch (action) {
    case 'probe':
        if (!$.AXIsProcessTrusted()) throw Error('TCC Accessibility is not granted; native appearance unavailable');
        events.applicationProcesses.length;
        if (Number(running().count) !== 0) throw Error('Use a disposable desktop without an existing System Settings process');
        result = true;
        break;
    case 'owner': result = owner(); break;
    case 'controls-ready': {
        const found = controls();
        result = {ready: Boolean(found.refs.contrast && found.refs.transparency)};
        if (result.ready) result.controls = found.paths;
        break;
    }
    case 'read': {
        const found = controls();
        result = {...state(found.refs), controls: found.paths};
        break;
    }
    case 'set': {
        const requested = JSON.parse(argument);
        if (!['contrast', 'transparency'].includes(requested.key) || typeof requested.value !== 'boolean') {
            throw Error('Unsupported accessibility preference request');
        }
        const found = controls();
        const changed = state(found.refs)[requested.key] !== requested.value;
        if (changed) found.refs[requested.key].actions.byName('AXPress').perform();
        result = {changed, controls: found.paths};
        break;
    }
    case 'close':
        result = {requested: owned().app.terminate() === true};
        break;
    case 'closed': {
        const token = JSON.parse(identity);
        const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(token.pid);
        result = !app || app.isTerminated === true || ObjC.unwrap(app.bundleIdentifier) !== bundle ||
            Number(app.launchDate.timeIntervalSince1970) !== token.started;
        break;
    }
    case 'force-close':
        if (JSON.parse(argument).restoration_verified !== true) throw Error('Force quit requires verified preference restoration');
        if (!owned().app.forceTerminate()) throw Error('Owned System Settings force quit failed');
        result = true;
        break;
    case 'backdrop': {
        const app = $.NSApplication.sharedApplication;
        app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
        const rect = $.NSScreen.mainScreen.frame;
        const window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
            rect, $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false);
        if (!window) throw Error('Owned native backdrop window unavailable');
        window.releasedWhenClosed = false;
        const colours = [[0.9, 0.1, 0.1], [0.1, 0.7, 0.2], [0.1, 0.2, 0.9]];
        const views = colours.map((colour, index) => {
            const view = $.NSView.alloc.initWithFrame($.NSMakeRect(rect.size.width * index / 3, 0, rect.size.width / 3, rect.size.height));
            view.wantsLayer = true;
            view.layer.backgroundColor = $.NSColor.colorWithCalibratedRedGreenBlueAlpha(...colour, 1).CGColor;
            window.contentView.addSubview(view);
            return view;
        });
        window.orderFrontRegardless;
        window.displayIfNeeded;
        // Owned process blocks in AppKit's actual run loop; Python terminates
        // only this Popen child, retaining the window and view references here.
        $.NSFileHandle.fileHandleWithStandardOutput.writeData($('{"ready":true}\n').dataUsingEncoding($.NSUTF8StringEncoding));
        app.run;
        result = views.length === 3;
        break;
    }
    default: throw Error('Unknown native appearance action');
    }
    return JSON.stringify(result);
}
