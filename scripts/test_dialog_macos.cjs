const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { unique, flags, locationFlags, validateToken, locationProgress, discoveryFacts } = require('./dialog-macos.js');
const executable = '/private/tmp/ibis-native/ibis';

test('native dialog actions refuse ambiguous targets', () => {
  assert.equal(unique([]), null);
  const owned = {};
  assert.equal(unique([owned]), owned);
  assert.throws(() => unique([owned, {}]), /ambiguous/);
});

test('an absent dialog cannot claim focus or ownership', () => {
  assert.deepEqual(flags(false, false), { visible: false, foreground: false, owned: false });
  assert.throws(() => flags(false, true), /inconsistent/);
});

test('missing and malformed native metadata cannot become a passed state', () => {
  for (const value of [undefined, null, 0, 1, 'true']) {
    assert.throws(() => flags(value, false), /boolean/);
    assert.throws(() => locationFlags(value, true), /boolean/);
  }
  assert.throws(() => locationFlags(true, false), /inconsistent/);
  assert.deepEqual(locationFlags(false, true), { ready: false, owned: true });
});

function nativeScenario({owner = 123, foreground = 123, duplicate = false, pressFailure = false, location = false, duplicateLocation = false, forbidBrowserTraversal = false, windowTitle = 'Choose a BibTeX or BibLaTeX library', attached = false, parentBoundsUnavailable = false, dialogFrameMismatch = false, physicalSheet = false, forbidAX = false, tokenWindows, postFailure = false, onPrepare = () => {}} = {}) {
  let presses = 0, windowValueReads = 0;
  const posted = [];
  const node = (name, role, focused = false, children = []) => ({
    name: () => name, title: () => name, description: () => '', value: () => '', role: () => role,
    position: () => [10, 20], size: () => [500, 400], entireContents: () => children,
    attributes: {byName: () => ({value: () => focused})},
    actions: {byName: () => ({perform: () => { presses++; if (pressFailure) throw Error('private payload'); }})},
  });
  const open = node('Open', 'AXButton');
  const cancel = node('Cancel', 'AXButton');
  const focus = node('Files', 'AXOutline', true);
  const field = node('', 'AXTextField', true);
  const sheet = node('', 'AXSheet', false, [field]);
  if (physicalSheet) { sheet.position = () => [15, 25]; sheet.size = () => [450, 120]; }
  const window = node(windowTitle, 'AXWindow', false,
    location ? [open, cancel, focus, sheet, field] : [open, cancel, focus]);
  window.value = () => { windowValueReads++; return ''; };
  if (parentBoundsUnavailable) window.position = () => { throw Error('Unrelated parent bounds unavailable'); };
  window.sheets = () => location ? (duplicateLocation ? [sheet, sheet] : [sheet]) : [];
  if (attached) {
    const dialog = node('Choose a BibTeX or BibLaTeX library', 'AXSheet', false,
      location ? [open, cancel, focus, sheet, field] : [open, cancel, focus]);
    dialog.sheets = window.sheets;
    if (dialogFrameMismatch) dialog.position = () => [800, 600];
    window.name = () => 'Ibis'; window.title = () => 'Ibis';
    window.sheets = () => duplicate ? [dialog, dialog] : [dialog];
  }
  if (forbidBrowserTraversal) window.entireContents = () => { throw Error('Do not enumerate the file browser to poll its path sheet'); };
  let metadata = tokenWindows || [{kCGWindowOwnerPID: owner, kCGWindowNumber: 10, kCGWindowAlpha: 1,
    kCGWindowBounds: {X: 10, Y: 20, Width: 500, Height: 400}}];
  if (physicalSheet) metadata.unshift({kCGWindowOwnerPID: owner, kCGWindowNumber: 20, kCGWindowAlpha: 1,
    kCGWindowBounds: {X: 15, Y: 25, Width: 450, Height: 120}});
  const context = {
    module: {exports: {}},
    ObjC: {import: () => {}, unwrap: value => value.value, deepUnwrap: value => value, castRefToObject: value => value},
    Application: () => {
      if (forbidAX) throw Error('No AX traversal after Go To Folder closes');
      return {applicationProcesses: {whose: () => () => [{windows: () => duplicate ? [window, window] : [window]}]}};
    },
    $: Object.assign(value => ({dataUsingEncoding: () => value}), {
      NSFileHandle: {fileHandleWithStandardError: {writeData: () => {}}},
      AXIsProcessTrusted: () => true,
      NSRunningApplication: {runningApplicationWithProcessIdentifier: () => ({processIdentifier: 123, isTerminated: false,
        launchDate: null, executableURL: {isFileURL: true, path: {value: executable}}})},
      NSWorkspace: {sharedWorkspace: {frontmostApplication: {processIdentifier: foreground}}},
      CGWindowListCopyWindowInfo: () => metadata, CFArrayGetCount: refs => refs.length,
      CFArrayGetValueAtIndex: (refs, index) => refs[index],
      CGPreflightPostEventAccess: () => true, CGEventSourceCreate: () => ({}),
      CGEventCreateKeyboardEvent: (source, code, down) => ({code, down}),
      CGEventSetFlags: (event, flags) => { event.flags = flags; onPrepare(); },
      CGEventPost: (tap, event) => { posted.push(event); if (postFailure) throw Error('private native failure'); },
    }),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./dialog-macos.js'), 'utf8'), context);
  return {call: (action, token) => JSON.parse(context.run([action, '123', executable, JSON.stringify(token)].slice(0, token === undefined ? 3 : 4))), presses: () => presses,
    windowValueReads: () => windowValueReads, posted, setWindows: value => { metadata = value; }};
}

test('foreign CG ownership cannot authorize native dialog actions', () => {
  const native = nativeScenario({owner: 456});
  assert.deepEqual(native.call('state'), {visible: false, foreground: false, owned: false});
  assert.throws(() => native.call('confirm'), /not foreground/);
  assert.equal(native.presses(), 0);
});

test('two owned dialogs are rejected instead of choosing the first', () => {
  const native = nativeScenario({duplicate: true});
  assert.throws(() => native.call('cancel'), /ambiguous/);
  assert.equal(native.presses(), 0);
});

test('an inactive app cannot invoke a visible owned dialog', () => {
  const native = nativeScenario({foreground: 456});
  assert.deepEqual(native.call('state'), {visible: true, foreground: false, owned: true});
  assert.throws(() => native.call('confirm'), /not foreground/);
  assert.equal(native.presses(), 0);
});

test('AX failure is sanitized and never retries a potentially completed action', () => {
  const native = nativeScenario({pressFailure: true});
  assert.throws(() => native.call('confirm'), error => error.message === 'Native dialog action failed');
  assert.equal(native.presses(), 1);
});

test('path entry requires a focused field inside the owned nested sheet', () => {
  assert.deepEqual(nativeScenario().call('location-state'), {ready: false, owned: true});
  assert.deepEqual(nativeScenario({location: true}).call('location-state'), {ready: true, owned: true});
  const native = nativeScenario();
  assert.deepEqual(native.call('confirm'), {invoked: true});
  assert.equal(native.presses(), 1);
});

test('path-sheet polling does not enumerate the native file browser before or after Return', () => {
  assert.deepEqual(nativeScenario({forbidBrowserTraversal: true}).call('location-state'), {ready: false, owned: true});
  assert.deepEqual(nativeScenario({location: true, forbidBrowserTraversal: true}).call('location-state'), {ready: true, owned: true});
});

test('direct path-sheet polling still rejects duplicate fields and inactive ownership', () => {
  assert.throws(() => nativeScenario({location: true, duplicateLocation: true}).call('location-state'), /ambiguous/);
  assert.deepEqual(nativeScenario({location: true, foreground: 456}).call('location-state'), {ready: false, owned: true});
  assert.deepEqual(nativeScenario({location: true, owner: 456}).call('location-state'), {ready: false, owned: false});
});

test('after the chooser closes, discovery does not enumerate the remaining picker document', () => {
  const native = nativeScenario({windowTitle: 'Ibis', forbidBrowserTraversal: true});
  assert.deepEqual(native.call('location-state'), {ready: false, owned: false});
  assert.deepEqual(native.call('state'), {visible: false, foreground: false, owned: false});
});

test('window discovery never requests an editable value from a native window', () => {
  for (const windowTitle of ['Ibis', 'Choose a BibTeX or BibLaTeX library']) {
    const native = nativeScenario({windowTitle});
    native.call('state');
    assert.equal(native.windowValueReads(), 0);
  }
});

test('an owned attached chooser uses the direct sheet collection and keeps ambiguity checks', () => {
  const native = nativeScenario({attached: true, location: true, forbidBrowserTraversal: true});
  assert.deepEqual(native.call('state'), {visible: true, foreground: true, owned: true});
  assert.deepEqual(native.call('location-state'), {ready: true, owned: true});
  assert.deepEqual(native.call('cancel'), {invoked: true});
  assert.equal(native.presses(), 1);
  assert.throws(() => nativeScenario({attached: true, duplicate: true}).call('confirm'), /ambiguous/);
});

test('attached chooser discovery verifies its own frame without querying unrelated parent bounds', () => {
  const native = nativeScenario({attached: true, location: true, parentBoundsUnavailable: true});
  assert.deepEqual(native.call('location-state'), {ready: true, owned: true});
  assert.deepEqual(native.call('confirm'), {invoked: true});
  assert.equal(native.presses(), 1);
});

test('a visible parent cannot authorize an attached dialog with a different native frame', () => {
  const native = nativeScenario({attached: true, dialogFrameMismatch: true});
  assert.deepEqual(native.call('state'), {visible: false, foreground: false, owned: false});
  assert.throws(() => native.call('confirm'), /not foreground/);
  assert.equal(native.presses(), 0);
});

test('a window with no native sheets needs no unrelated bounds query', () => {
  const native = nativeScenario({windowTitle: 'Ibis', parentBoundsUnavailable: true});
  assert.deepEqual(native.call('location-state'), {ready: false, owned: false});
  assert.deepEqual(native.call('state'), {visible: false, foreground: false, owned: false});
});


// Public C AX ABI model. CF objects remain opaque until their type is checked;
// out parameters and CGPoint/CGSize outputs model the documented SDK signatures.
function axScenario(options = {}) {
  const types = {AX: 1, string: 2, bool: 3, array: 4, value: 5};
  const bridged = new WeakMap();
  const asObject = value => {
    if (value.nativeObject) return value;
    if (!bridged.has(value)) bridged.set(value, Object.assign(Object.create(value),
      {nativeObject: true, nativeRef: value, isNil: () => false}));
    return bridged.get(value);
  };
  const string = value => ({type: 'string', value, dataUsingEncoding: () => value});
  const bool = value => ({type: 'bool', value});
  const array = value => ({type: 'array', value});
  const geometry = (kind, value) => ({type: 'value', kind, value});
  const ax = (role, attributes = {}) => ({type: 'AX', pid: 123, attrs: {AXRole: string(role), ...attributes}});
  const panelBounds = {X: 10, Y: 20, Width: 500, Height: 400};
  const sheetBounds = {X: 15, Y: 25, Width: 450, Height: 120};
  const frames = bounds => ({AXPosition: geometry(1, {x: bounds.X, y: bounds.Y}),
    AXSize: geometry(2, {width: bounds.Width, height: bounds.Height})});
  const panel = ax('AXWindow', {AXTitle: string('Choose a BibTeX or BibLaTeX library'), ...frames(panelBounds)});
  const sheet = ax('AXSheet', {AXParent: panel, ...frames(sheetBounds)});
  const field = ax('AXTextField', {AXParent: sheet, AXFocused: bool(true)});
  sheet.attrs.AXChildren = array([field]);
  const button = ax('AXButton', {AXParent: panel, AXTitle: string('Open'), AXEnabled: bool(true)});
  const browser = ax('AXOutline', {AXParent: panel});
  const app = ax('AXApplication', {AXWindows: array([panel]), AXFocusedUIElement: field});
  const system = ax('AXSystemWide');
  const unknown = ax('AXSheet', {AXParent: panel, ...frames(sheetBounds)});
  let windows = [{kCGWindowNumber: 10, kCGWindowOwnerPID: 123, kCGWindowAlpha: 1, kCGWindowBounds: panelBounds}];
  let foreground = 123, processPid = 123, processExecutable = executable, registered = true, terminated = false, elapsed = 0, failure = null;
  const timeouts = [], posted = [], reads = [], stages = [], diagnostics = [], readiness = [], discovery = [], pidReads = [];
  const status = (name, attribute) => {
    reads.push([name, attribute]);
    if (options.onRead) options.onRead(api, name, attribute);
    if (options.nativeThrow) throw Error('private native payload');
    elapsed += options.callMilliseconds || 0;
    return failure && (!failure.attribute || failure.attribute === attribute) ? failure.code : 0;
  };
  const read = (element, attribute, output) => {
    if (options.requireNativeObjects && !element.nativeObject) return -25202;
    const name = attribute.value;
    const error = status('read', name);
    if (error) return error;
    if (!(name in element.attrs)) return -25205;
    output[0] = options.sdkReturnsObjects ? asObject(element.attrs[name]) : element.attrs[name]; return 0;
  };
  panel.attrs.AXDefaultButton = button;
  const setPathOpen = value => {
    panel.attrs.AXChildren = array(value ? [sheet, button, browser] : [button, browser]);
    app.attrs.AXFocusedUIElement = value ? field : browser;
  };
  setPathOpen(true);
  const context = {
    module: {exports: {}},
    Ref: type => Object.assign([], {refType: type}),
    Application: () => { throw Error('System Events must not be used for bounded C AX observations'); },
    ObjC: {import() {}, unwrap: value => value.value, deepUnwrap: value => value,
      castRefToObject: value => {
        if (options.throwCast || (options.forbidObjectRecast && value.nativeObject)) throw Error('private bridge cast failure');
        if (options.nilCast) return {isNil: () => true};
        return asObject(value);
      }, bindFunction() { throw Error('Missing ABI binding'); }},
    $: Object.assign(string, {
      NSFileHandle: {fileHandleWithStandardError: {writeData(value) {
        const discoveryPrefix = 'NATIVE CHOOSER MACOS DISCOVERY ';
        if (value.startsWith(discoveryPrefix)) { discovery.push(JSON.parse(value.slice(discoveryPrefix.length))); return; }
        const readyPrefix = 'NATIVE CHOOSER MACOS READY ';
        if (value.startsWith(readyPrefix)) {
          const payload = JSON.parse(value.slice(readyPrefix.length));
          assert.deepEqual(Object.keys(payload), ['reason']); readiness.push(payload); return;
        }
        const axPrefix = 'NATIVE CHOOSER MACOS AX ';
        if (value.startsWith(axPrefix)) {
          const payload = JSON.parse(value.slice(axPrefix.length));
          assert.deepEqual(Object.keys(payload).sort(), ['api', 'reason']); diagnostics.push(payload); return;
        }
        const prefix = 'NATIVE CHOOSER MACOS ';
        assert.equal(value.startsWith(prefix), true);
        const payload = JSON.parse(value.slice(prefix.length));
        assert.deepEqual(Object.keys(payload), ['stage']); stages.push(payload.stage);
      }}},
      NSProcessInfo: {processInfo: {get systemUptime() { return elapsed / 1000; }}},
      AXIsProcessTrusted: () => true,
      NSRunningApplication: {runningApplicationWithProcessIdentifier: () => registered ? ({isTerminated: terminated,
        processIdentifier: processPid, get launchDate() { throw Error('Launch Services metadata is unavailable for direct children'); },
        executableURL: processExecutable === null ? null : {isFileURL: true, path: string(processExecutable)}}) : null},
      NSWorkspace: {sharedWorkspace: {get frontmostApplication() { return {processIdentifier: foreground}; }}},
      CGWindowListCopyWindowInfo: () => windows, CFArrayGetCount: refs => {
        if (options.requireNativeObjects && !Array.isArray(refs) && !refs.nativeObject) throw Error('Ref was boxed instead of passed to typed CF array API');
        const count = Array.isArray(refs) ? refs.length : refs.value.length;
        return options.stringLong ? String(count) : count;
      },
      CFArrayGetValueAtIndex: (refs, index) => Array.isArray(refs) ? refs[index] : refs.value[index],
      CFGetTypeID: value => {
        // Generic CFTypeRef receives a wrapper dictionary for an unbridged
        // opaque Ref in JXA; this is a different CF object, not a scalar issue.
        if (options.genericCFBoxing && !value.nativeObject) return 99;
        if (Object.hasOwn(options, 'actualTypeId')) return options.actualTypeId;
        return options.actualTypeIdsAsStrings ? String(types[value.type]) : types[value.type];
      }, CFStringGetTypeID: () => types.string,
      CFBooleanGetTypeID: () => types.bool, CFArrayGetTypeID: () => types.array,
      CFBooleanGetValue: value => {
        if (options.requireNativeObjects && !value.nativeObject) throw Error('Expected native CFBoolean');
        return options.numericBoolean ? Number(value.value) : value.value;
      },
      CFEqual: (left, right) => {
        // Raw opaque AX Refs can box into identical metadata dictionaries.
        const equal = options.genericCFBoxing && !left.nativeObject && !right.nativeObject ? true :
          (left.nativeRef || left) === (right.nativeRef || right);
        return options.numericBoolean ? Number(equal) : equal;
      },
      AXUIElementGetTypeID: () => options.expectedTypeIdsAsStrings ? String(types.AX) : types.AX,
      AXValueGetTypeID: () => options.expectedTypeIdsAsStrings ? String(types.value) : types.value,
      AXUIElementCreateSystemWide: () => options.nilSystem ? null : options.sdkReturnsObjects ? asObject(system) : system,
      AXUIElementCreateApplication: () => options.sdkReturnsObjects ? asObject(app) : app,
      AXUIElementSetMessagingTimeout: (element, seconds) => {
        if (options.requireNativeObjects && !element.nativeObject) return -25202;
        timeouts.push([element.nativeRef || element, seconds]); return options.timeoutFailure ? -25201 : 0;
      },
      AXUIElementGetPid: (element, output) => {
        if (options.requireNativeObjects && !element.nativeObject) return -25202;
        pidReads.push(element.nativeRef || element);
        output[0] = element.pid; return 0;
      },
      AXUIElementCopyAttributeValue: read,
      AXUIElementGetAttributeValueCount: (element, attribute, output) => {
        if (options.requireNativeObjects && !element.nativeObject) return -25202;
        const error = status('count', attribute.value);
        if (error) return error;
        const value = element.attrs[attribute.value];
        if (!value || value.type !== 'array') return -25205;
        output[0] = options.stringLong ? String(value.value.length) : value.value.length; return 0;
      },
      AXUIElementCopyAttributeValues: (element, attribute, index, maximum, output) => {
        if (options.requireNativeObjects && !element.nativeObject) return -25202;
        const error = status('array', attribute.value);
        if (error) return error;
        const value = element.attrs[attribute.value];
        if (!value || value.type !== 'array') return -25205;
        const result = array(value.value.slice(index, index + maximum));
        output[0] = options.sdkReturnsObjects ? asObject(result) : result; return 0;
      },
      CGPointMake: (x, y) => ({x, y}), CGSizeMake: (width, height) => ({width, height}),
      AXValueGetType: value => options.requireNativeObjects && !value.nativeObject ? 0 : value.kind,
      AXValueGetValue: (value, kind, output) => {
        if (options.requireNativeObjects && !value.nativeObject) return false;
        if (kind !== value.kind || output.refType !== (kind === 1 ? 'CGPoint' : 'CGSize')) return false;
        if (options.requireStructStorage && (!output[0] || Object.values(output[0]).some(value => value !== 0))) return false;
        output[0] = value.value; return options.numericBoolean ? 1 : true;
      },
      CGPreflightPostEventAccess: () => true, CGEventSourceCreate: () => ({}),
      CGEventCreateKeyboardEvent: (source, code, down) => ({code, down}),
      CGEventSetFlags: (event, flags) => { event.flags = flags; if (options.onPrepare) options.onPrepare(api); },
      CGEventPost: (tap, event) => { posted.push(event); if (options.postFailure) throw Error('Private native payload'); },
    }),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./dialog-macos.js'), 'utf8'), context);
  const api = {panel, sheet, field, button, browser, app, unknown, posted, timeouts, reads, stages, diagnostics, readiness, discovery, pidReads, system, bool, array, string,
    call: (action, token, expectedExecutable = executable) => JSON.parse(context.run([action, '123', expectedExecutable, JSON.stringify(token)].slice(0, token === undefined ? 3 : 4))), setPathOpen,
    fail: (attribute, code = -25204) => { failure = {attribute, code}; },
    setWindows: value => { windows = value; }, setForeground: value => { foreground = value; },
    setExecutable: value => { processExecutable = value; }, setPid: value => { processPid = value; },
    setRegistered: value => { registered = value; }, setTerminated: value => { terminated = value; },
    remove: (name, throwingGetter = false) => {
      delete context.$[name];
      if (throwingGetter) Object.defineProperty(context.$, name, {get() { throw Error('private bridge lookup'); }});
    }};
  return api;
}
const identity = () => ({owner: {pid: 123, executable},
  panel: {window: 10, bounds: {X: 10, Y: 20, Width: 500, Height: 400}},
  sheet: {bounds: {X: 15, Y: 25, Width: 450, Height: 120}}});

test('a logical direct path sheet may share its panel physical surface', () => {
  const native = axScenario();
  assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
  assert.equal(native.timeouts[0][0], native.system);
  assert.equal(native.timeouts[0][1], 0.25, 'Set the process-global AX timeout, not just the app element');
});

test('logical tokens reject physical sheet IDs, foreign owners and malformed bounds', () => {
  for (const token of [null, {}, {...identity(), owner: {pid: 456, executable}},
    {...identity(), sheet: {...identity().sheet, window: 20}},
    {...identity(), sheet: {bounds: {...identity().sheet.bounds, Width: 0}}}]) {
    assert.throws(() => validateToken(token, 123, executable), /metadata/);
  }
});

test('fresh bounded AX proves direct sheet absence and exact enabled default Open before readiness', () => {
  const native = axScenario();
  assert.deepEqual(native.call('after-location', identity()), {ready: false, closed: false});
  native.setPathOpen(false);
  assert.deepEqual(native.call('after-location', identity()), {ready: true, closed: false});
  native.button.attrs.AXEnabled = native.bool(false);
  assert.deepEqual(native.call('after-location', identity()), {ready: false, closed: false});
  assert.throws(() => native.call('confirm-key', identity()), /not ready/);
  assert.equal(native.posted.length, 0);
});

test('AX messaging failures never become sheet absence or panel closure', () => {
  for (const error of [-25204, -25202, -25205, -25212]) {
    const native = axScenario(); native.setPathOpen(false); native.fail('AXChildren', error);
    assert.throws(() => native.call('after-location', identity()), /AX/);
    assert.throws(() => native.call('confirm-key', identity()), /AX/);
    assert.equal(native.posted.length, 0);
  }
});

test('unavailable timeout, wrong CF types, excessive arrays and budget exhaustion fail closed', () => {
  const timeout = axScenario({timeoutFailure: true});
  assert.throws(() => timeout.call('location-identity'), /AX/);
  const type = axScenario(); type.setPathOpen(false); type.button.attrs.AXEnabled = type.string('true');
  assert.throws(() => type.call('confirm-key', identity()), /AX/);
  const large = axScenario(); large.panel.attrs.AXChildren = large.array(Array(65).fill(large.button));
  assert.throws(() => large.call('location-identity'), /bound/);
  const deadline = axScenario({callMilliseconds: 1000});
  assert.throws(() => deadline.call('location-identity'), /budget/);
});

test('focused editable ancestry, unique direct sheet and owned default button are required', () => {
  const duplicate = axScenario(); duplicate.panel.attrs.AXChildren = duplicate.array([duplicate.sheet, duplicate.unknown]);
  assert.throws(() => duplicate.call('location-identity'), /ambiguous/);
  const foreign = axScenario(); foreign.field.pid = 456;
  assert.throws(() => foreign.call('location-identity'), /ownership/);
  const wrong = axScenario(); wrong.setPathOpen(false); wrong.button.attrs.AXTitle = wrong.string('Save');
  assert.throws(() => wrong.call('confirm-key', identity()), /Open|not ready/);
  const cycle = axScenario(); cycle.setPathOpen(false); cycle.browser.attrs.AXParent = cycle.browser;
  assert.throws(() => cycle.call('after-location', identity()), /ancestry/);
});

test('a newly replaced logical sheet cannot authorize confirmation', () => {
  const native = axScenario(); native.panel.attrs.AXChildren = native.array([native.unknown]);
  assert.deepEqual(native.call('after-location', identity()), {ready: false, closed: false});
  assert.throws(() => native.call('confirm-key', identity()), /not ready/);
  assert.equal(native.posted.length, 0);
});

test('positive valid CG panel absence is closure; missing metadata is not', () => {
  const native = axScenario(); native.setWindows([]);
  assert.deepEqual(native.call('after-location', identity()), {ready: true, closed: true});
  native.setWindows(null);
  assert.throws(() => native.call('after-location', identity()), /metadata/);
});

test('one prepared balanced Return repeats AX and owner guards and never uses System Events', () => {
  const native = axScenario(); native.setPathOpen(false);
  assert.deepEqual(native.call('confirm-key', identity()), {invoked: true});
  assert.deepEqual(native.posted, [{code: 36, down: true, flags: 0}, {code: 36, down: false, flags: 0}]);
  const changed = axScenario({onPrepare: api => { api.button.attrs.AXEnabled = api.bool(false); }});
  changed.setPathOpen(false);
  assert.throws(() => changed.call('confirm-key', identity()), /not ready/);
  assert.equal(changed.posted.length, 0);
});

test('executable changes and denied preflight never reach input', () => {
  const changed = axScenario(); changed.setExecutable('/private/tmp/foreign');
  assert.throws(() => changed.call('after-location', identity()), /identity changed/);
  const denied = axScenario(); denied.remove('CGPreflightPostEventAccess'); denied.setPathOpen(false);
  assert.throws(() => denied.call('confirm-key', identity()), /preflight/);
  assert.equal(denied.posted.length, 0);
});

test('posting failure releases once and never retries', () => {
  const native = axScenario({postFailure: true}); native.setPathOpen(false);
  assert.throws(() => native.call('confirm-key', identity()), error => error.message === 'Native dialog keyboard action failed');
  assert.equal(native.posted.length, 2);
  assert.equal(native.posted[1].down, false);
});


test('SDK uint8 Boolean returns accept only exact 0/1 or bridged booleans', () => {
  const native = axScenario({numericBoolean: true});
  assert.equal(native.call('location-identity').ready, true);
  native.setPathOpen(false);
  assert.equal(native.call('after-location', identity()).ready, true);
  native.button.attrs.AXEnabled = native.bool(false);
  assert.equal(native.call('after-location', identity()).ready, false);
  const malformed = axScenario(); malformed.setPathOpen(false);
  malformed.button.attrs.AXEnabled = malformed.bool(2);
  assert.throws(() => malformed.call('confirm-key', identity()), /boolean/);
  assert.equal(malformed.posted.length, 0);
});

test('PID token boundaries match signed pid_t rather than CGWindowID', () => {
  const token = {...identity(), owner: {pid: 0x80000000, executable}};
  assert.throws(() => validateToken(token, token.owner.pid, executable), /metadata/);
  const maximum = {...identity(), owner: {pid: 0x7fffffff, executable}};
  assert.equal(validateToken(maximum, maximum.owner.pid, executable), maximum);
});

test('final input guard refreshes CG and foreground after AX observations', () => {
  for (const mutate of [api => api.setForeground(456), api => api.setTerminated(true),
    api => api.setExecutable('/private/tmp/foreign'), api => api.setPid(456),
    api => api.setWindows([]), api => api.setWindows([{kCGWindowNumber: 10, kCGWindowOwnerPID: 456}])]) {
    const native = axScenario({onRead: (api, name, attribute) => {
      if (attribute === 'AXEnabled') mutate(api);
    }});
    native.setPathOpen(false);
    assert.throws(() => native.call('confirm-key', identity()), /ready|identity|ownership/);
    assert.equal(native.posted.length, 0);
  }
});

test('issuing a typing token refreshes foreground and panel presence after AX proof', () => {
  for (const mutate of [api => api.setForeground(456), api => api.setWindows([])]) {
    const native = axScenario({onRead: (api, name, attribute) => {
      if (attribute === 'AXSize') mutate(api);
    }});
    const result = native.call('location-identity');
    assert.equal(result.ready, false);
    assert.equal(result.token, null);
    assert.equal(native.posted.length, 0);
  }
});


test('native AX exceptions are sanitized and cannot retry input', () => {
  const native = axScenario({nativeThrow: true}); native.setPathOpen(false);
  assert.throws(() => native.call('confirm-key', identity()),
    error => error.message === 'Native AX public call failed');
  assert.equal(native.posted.length, 0);
});


test('a logical sheet appearing during the default-button check blocks Return', () => {
  const native = axScenario({onRead: (api, name, attribute) => {
    if (attribute === 'AXEnabled') api.setPathOpen(true);
  }});
  native.setPathOpen(false);
  assert.throws(() => native.call('confirm-key', identity()), /not ready/);
  assert.equal(native.posted.length, 0);
});


test('public AX diagnostics expose fixed stages without element values', () => {
  const native = axScenario(); native.call('location-identity');
  native.setPathOpen(false); native.call('confirm-key', identity());
  for (const stage of ['identity', 'scope', 'windows', 'candidates', 'bounds', 'location', 'sheets', 'controls', 'invoke']) {
    assert.equal(native.stages.includes(stage), true, stage);
  }
  assert.equal(native.stages.every(stage => ['identity', 'scope', 'windows', 'candidates', 'bounds',
    'location', 'sheets', 'controls', 'invoke'].includes(stage)), true);
  const failed = axScenario(); failed.fail('AXPosition');
  assert.throws(() => failed.call('location-identity'), /AX/);
  assert.equal(failed.stages.at(-1), 'bounds');
});


test('JXA CFIndex strings and concrete initialized struct output storage are supported', () => {
  const native = axScenario({stringLong: true, requireStructStorage: true});
  assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
  native.setPathOpen(false);
  assert.deepEqual(native.call('after-location', identity()), {ready: true, closed: false});
});


test('an owned direct child with unavailable Launch Services date can prove the logical sheet', () => {
  const native = axScenario(); // launchDate getter throws if anything reads it.
  assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
  native.setPathOpen(false);
  assert.deepEqual(native.call('confirm-key', identity()), {invoked: true});
  assert.equal(native.posted.length, 2);
});

test('only pre-token registration metadata absence is an unready result', () => {
  for (const unavailable of [api => api.setRegistered(false), api => api.setExecutable(null)]) {
    const native = axScenario(); unavailable(native);
    assert.deepEqual(native.call('location-identity'), {ready: false, owned: false, token: null});
    for (const action of ['after-location', 'confirm-key', 'cancel', 'confirm', 'state', 'location-state']) {
      assert.throws(() => native.call(action, ['after-location', 'confirm-key'].includes(action) ? identity() : undefined), /process|metadata/);
    }
    assert.equal(native.posted.length, 0);
  }
});

test('wrong executable, foreign PID and termination are fatal even before token issuance', () => {
  for (const mutate of [api => api.setExecutable('/private/tmp/foreign'), api => api.setExecutable('relative'), api => api.setPid(456),
    api => api.setTerminated(true)]) {
    const native = axScenario(); mutate(native);
    assert.throws(() => native.call('location-identity'), /identity|process/);
    assert.throws(() => native.call('confirm-key', identity()), /identity|process/);
    assert.equal(native.posted.length, 0);
  }
});

test('owner token executable is exact, bounded and has no obsolete timestamp', () => {
  for (const owner of [{pid: 123, executable: 'relative'}, {pid: 123, executable: '/private/tmp/foreign'},
    {pid: 123, executable: '/' + 'x'.repeat(1024)}, {pid: 123, executable: '/bad\0path'},
    {pid: 123, started: 7}, {pid: 123, executable, started: 7}]) {
    assert.throws(() => validateToken({...identity(), owner}, 123, executable), /metadata/);
  }
});


test('every action rejects an invalid expected executable before native work', () => {
  for (const expected of ['', 'relative', '/bad\0path', '/' + 'x'.repeat(1024)]) {
    const native = axScenario();
    assert.throws(() => native.call('location-identity', undefined, expected), /identity/);
    assert.throws(() => native.call('confirm-key', identity(), expected), /identity/);
    assert.equal(native.reads.length, 0);
    assert.equal(native.posted.length, 0);
  }
});


test('unsigned long CF type IDs normalize exact canonical number and string representations', () => {
  for (const options of [{expectedTypeIdsAsStrings: true}, {actualTypeIdsAsStrings: true},
    {expectedTypeIdsAsStrings: true, actualTypeIdsAsStrings: true}]) {
    const native = axScenario(options);
    assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
    native.setPathOpen(false);
    assert.deepEqual(native.call('confirm-key', identity()), {invoked: true});
    assert.deepEqual(native.diagnostics, []);
  }
});

const diagnosticAPIs = ['AXUIElementCreateSystemWide', 'AXUIElementCreateApplication', 'AXUIElementGetTypeID',
  'AXValueGetTypeID', 'AXUIElementSetMessagingTimeout', 'AXUIElementGetPid', 'AXUIElementCopyAttributeValue',
  'AXUIElementGetAttributeValueCount', 'AXUIElementCopyAttributeValues', 'AXValueGetType', 'AXValueGetValue',
  'CFGetTypeID', 'CFEqual', 'CFStringGetTypeID', 'CFBooleanGetValue', 'CFBooleanGetTypeID', 'CFArrayGetTypeID',
  'CFArrayGetCount', 'CFArrayGetValueAtIndex', 'CGPointMake', 'CGSizeMake'];
const diagnosticReasons = ['bind-unavailable', 'call-exception', 'ax-error', 'missing-reference', 'invalid-type-id',
  'type-mismatch', 'owner-mismatch', 'budget-exceeded', 'invalid-result'];

test('malformed or unequal type IDs cannot become compatible refs or produce input', () => {
  for (const actualTypeId of [0, -1, '', ' 1', '1 ', '+1', '01', '1.0', '1e0', 'Infinity', Infinity,
    NaN, true, null, undefined, {}, Number.MAX_SAFE_INTEGER + 1, String(Number.MAX_SAFE_INTEGER + 1), 42]) {
    const native = axScenario({actualTypeId});
    assert.throws(() => native.call('location-identity'), /type/);
    assert.equal(native.posted.length, 0);
    assert.deepEqual(native.diagnostics, [{api: 'CFGetTypeID', reason: actualTypeId === 42 ? 'type-mismatch' : 'invalid-type-id'}]);
  }
});

test('AX initialization failures identify only a fixed API and reason once per helper', () => {
  const missing = axScenario(); missing.remove('AXUIElementGetPid');
  const timeout = axScenario({timeoutFailure: true});
  const nil = axScenario({nilSystem: true});
  const thrown = axScenario({nativeThrow: true});
  const budget = axScenario({callMilliseconds: 1000});
  const foreign = axScenario(); foreign.app.pid = 456;
  for (const [native, api, reason] of [[missing, 'AXUIElementGetPid', 'bind-unavailable'],
    [timeout, 'AXUIElementSetMessagingTimeout', 'ax-error'], [nil, 'CFGetTypeID', 'missing-reference'],
    [thrown, 'AXUIElementGetAttributeValueCount', 'call-exception'],
    [budget, 'AXUIElementCopyAttributeValue', 'budget-exceeded'], [foreign, 'AXUIElementGetPid', 'owner-mismatch']]) {
    assert.throws(() => native.call('location-identity'), /AX/);
    assert.deepEqual(native.diagnostics, [{api, reason}]);
    assert.equal(native.diagnostics.every(row => diagnosticAPIs.includes(row.api) && diagnosticReasons.includes(row.reason)), true);
    assert.equal(JSON.stringify(native.diagnostics).includes('private'), false);
    assert.equal(native.posted.length, 0);
  }
});


test('a throwing missing-symbol lookup is a bounded binding failure with no raw diagnostic', () => {
  const native = axScenario(); native.remove('AXUIElementGetPid', true);
  assert.throws(() => native.call('location-identity'), error => error.message === 'Native AX public API unavailable');
  assert.deepEqual(native.diagnostics, [{api: 'AXUIElementGetPid', reason: 'bind-unavailable'}]);
  assert.equal(native.posted.length, 0);
});


test('generic CF operations receive the underlying object rather than a Ref wrapper dictionary', () => {
  const native = axScenario({genericCFBoxing: true, requireNativeObjects: true});
  assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
  native.setPathOpen(false);
  assert.deepEqual(native.call('confirm-key', identity()), {invoked: true});
  assert.equal(native.posted.length, 2);
  assert.deepEqual(native.diagnostics, []);
});

test('bridging CF Refs preserves foreign-type, foreign-owner and distinct-element rejection', () => {
  const type = axScenario({genericCFBoxing: true, actualTypeId: 42});
  assert.throws(() => type.call('location-identity'), /type/);
  const owner = axScenario({genericCFBoxing: true}); owner.field.pid = 456;
  assert.throws(() => owner.call('location-identity'), /ownership/);
  const duplicate = axScenario({genericCFBoxing: true});
  duplicate.panel.attrs.AXChildren = duplicate.array([duplicate.sheet, duplicate.unknown]);
  assert.throws(() => duplicate.call('location-identity'), /ambiguous/);
  const outside = axScenario({genericCFBoxing: true});
  outside.field.attrs.AXParent = outside.panel;
  assert.deepEqual(outside.call('location-identity'), {ready: false, owned: true, token: null});
  outside.setPathOpen(false); outside.browser.attrs.AXParent = outside.unknown;
  outside.unknown.attrs.AXParent = outside.unknown;
  assert.throws(() => outside.call('confirm-key', identity()), /AX/);
  for (const native of [type, owner, duplicate, outside]) assert.equal(native.posted.length, 0);
});


test('already bridged SDK objects keep their identity without a second pointer conversion', () => {
  const native = axScenario({genericCFBoxing: true, requireNativeObjects: true,
    sdkReturnsObjects: true, forbidObjectRecast: true});
  assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
  native.setPathOpen(false);
  assert.deepEqual(native.call('confirm-key', identity()), {invoked: true});
  assert.deepEqual(native.diagnostics, []);
});

test('nil or throwing native CF conversions never bypass type checks or expose bridge payloads', () => {
  for (const [options, reason] of [[{nilCast: true}, 'missing-reference'], [{throwCast: true}, 'invalid-result']]) {
    const native = axScenario(options);
    assert.throws(() => native.call('location-identity'), error => error.message === 'Native AX value type unavailable' ||
      error.message === 'Native AX reference unavailable');
    assert.deepEqual(native.diagnostics, [{api: 'CFGetTypeID', reason}]);
    assert.equal(native.posted.length, 0);
  }
});


const readinessReasons = ['registration-unavailable', 'panel-not-found', 'not-foreground', 'sheet-absent',
  'focused-control-not-ready', 'focus-outside-sheet', 'final-ownership-not-ready'];

test('every normal unready location return emits one exact fixed branch marker', () => {
  const cases = [
    ['registration-unavailable', false, native => native.setRegistered(false)],
    ['panel-not-found', false, native => native.setWindows([])],
    ['not-foreground', true, native => native.setForeground(456)],
    ['sheet-absent', true, native => native.setPathOpen(false)],
    ['focused-control-not-ready', true, native => { native.field.attrs.AXFocused = native.bool(false); }],
    ['focused-control-not-ready', true, native => { native.field.attrs.AXRole = native.string('AXOutline'); }],
    ['focus-outside-sheet', true, native => { native.field.attrs.AXParent = native.panel; }],
  ];
  for (const [reason, owned, prepare] of cases) {
    const native = axScenario(); prepare(native);
    assert.deepEqual(native.call('location-identity'), {ready: false, owned, token: null});
    assert.deepEqual(native.readiness, [{reason}]);
    assert.equal(readinessReasons.includes(reason), true);
    assert.equal(native.posted.length, 0);
  }
});

test('late foreground or panel loss emits the final guard marker without changing metadata', () => {
  for (const [owned, mutate] of [[true, native => native.setForeground(456)], [false, native => native.setWindows([])]]) {
    const native = axScenario({onRead: (api, name, attribute) => {
      if (attribute === 'AXFocused') mutate(api);
    }});
    assert.deepEqual(native.call('location-identity'), {ready: false, owned, token: null});
    assert.deepEqual(native.readiness, [{reason: 'final-ownership-not-ready'}]);
    assert.equal(native.posted.length, 0);
  }
});

test('successful and fatal AX paths do not manufacture an unready branch reason', () => {
  const success = axScenario();
  assert.deepEqual(success.call('location-identity'), {ready: true, owned: true, token: identity()});
  assert.deepEqual(success.readiness, []);
  const failed = axScenario(); failed.fail('AXChildren');
  assert.throws(() => failed.call('location-identity'), /AX/);
  assert.deepEqual(failed.readiness, []);
  assert.equal(failed.posted.length, 0);
  assert.equal(JSON.stringify(failed.diagnostics).includes('private'), false);
});


const emptyDiscovery = () => ({windows: 0, direct_children: 0, direct_windows: 0, direct_sheets: 0,
  direct_dialog_roles: 0, titled_windows: 0, titled_sheets: 0, title_unavailable: 0, description_unavailable: 0,
  window_dialog_subroles: 0, window_standard_subroles: 0, window_subrole_unavailable: 0,
  direct_static_texts: 0, direct_static_title_matches: 0, title_empty: 0, title_other: 0,
  description_empty: 0, description_other: 0});

test('failure-only discovery identifies existing direct roles and missing labels without reading values', () => {
  const native = axScenario();
  native.panel.attrs.AXTitle = native.string('Synthetic private window title');
  native.panel.attrs.AXDescription = native.string('Synthetic private description');
  native.button.attrs.AXRole = native.string('AXDialog');
  native.browser.attrs.AXRole = native.string('AXWindow');
  assert.deepEqual(native.call('location-identity'), {ready: false, owned: false, token: null});
  assert.deepEqual(native.discovery, [{...emptyDiscovery(), windows: 1, direct_children: 3,
    direct_windows: 1, direct_sheets: 1, direct_dialog_roles: 1, title_unavailable: 1, description_unavailable: 1,
    window_subrole_unavailable: 1, title_other: 1, description_other: 1}]);
  assert.equal(native.reads.some(([, attribute]) => attribute === 'AXValue'), false);
  assert.equal(native.reads.filter(([name, attribute]) => name === 'count' && attribute === 'AXChildren').length, 2);
  assert.equal(native.reads.filter(([, attribute]) => attribute === 'AXRole').length, 5, 'Diagnostics add no separate role reads');
  assert.equal(JSON.stringify(native.discovery).includes('private'), false);
  assert.equal(native.posted.length, 0);
});

test('discovery distinguishes titled AX candidates from a failed CG match and stays absent on other outcomes', () => {
  const mismatch = axScenario(); mismatch.setWindows([]);
  assert.equal(mismatch.call('location-identity').ready, false);
  assert.deepEqual(mismatch.discovery, [{...emptyDiscovery(), windows: 1, titled_windows: 1, window_subrole_unavailable: 1}]);
  const success = axScenario(); assert.equal(success.call('location-identity').ready, true);
  assert.deepEqual(success.discovery, []);
  const failed = axScenario(); failed.fail('AXChildren');
  assert.throws(() => failed.call('location-identity'), /AX/);
  assert.deepEqual(failed.discovery, []);
});

test('discovery schema rejects payloads and every noninteger or excessive count', () => {
  assert.deepEqual(discoveryFacts(emptyDiscovery()), emptyDiscovery());
  assert.throws(() => discoveryFacts({...emptyDiscovery(), title: 'private'}), /discovery/);
  for (const [key, maximum] of Object.entries({windows: 20, titled_windows: 20, direct_children: 640,
    direct_windows: 640, direct_sheets: 640, direct_dialog_roles: 640, titled_sheets: 640,
    title_unavailable: 660, description_unavailable: 660, title_empty: 660, title_other: 660,
    description_empty: 660, description_other: 660, window_dialog_subroles: 20,
    window_standard_subroles: 20, window_subrole_unavailable: 20,
    direct_static_texts: 640, direct_static_title_matches: 640})) {
    assert.equal(discoveryFacts({...emptyDiscovery(), [key]: maximum})[key], maximum);
    for (const value of [-1, maximum + 1, 0.5, NaN, Infinity, true, '0', null]) {
      assert.throws(() => discoveryFacts({...emptyDiscovery(), [key]: value}), /discovery/);
    }
  }
});


test('discovery classifies only fixed subroles and the already enumerated direct header', () => {
  for (const [subrole, key] of [['AXDialog', 'window_dialog_subroles'], ['AXStandardWindow', 'window_standard_subroles']]) {
    const native = axScenario();
    native.panel.attrs.AXSubrole = native.string(subrole);
    native.panel.attrs.AXTitle = native.string('');
    native.panel.attrs.AXDescription = native.string('');
    native.unknown.attrs.AXRole = native.string('AXStaticText');
    native.unknown.attrs.AXValue = native.string('Choose a BibTeX or BibLaTeX library');
    native.panel.attrs.AXChildren = native.array([native.unknown]);
    assert.equal(native.call('location-identity').ready, false, 'Diagnostic header equality must not change panel matching');
    assert.deepEqual(native.discovery, [{...emptyDiscovery(), windows: 1, [key]: 1, direct_children: 1,
      direct_static_texts: 1, direct_static_title_matches: 1, title_empty: 1, description_empty: 1}]);
    assert.equal(native.reads.filter(([, attribute]) => attribute === 'AXValue').length, 1);
    assert.equal(native.posted.length, 0);
  }
});


test('failure discovery does not add diagnostic attribute reads to post-path guards', () => {
  const native = axScenario(); native.setPathOpen(false);
  assert.equal(native.call('after-location', identity()).ready, true);
  assert.equal(native.reads.some(([, attribute]) => ['AXSubrole', 'AXValue'].includes(attribute)), false);
  assert.deepEqual(native.discovery, []);
});

// Model the legacy-valid surface: an untitled direct sheet whose fixed banner
// identifies the chooser, while a separate nested sheet owns the path field.
function untitledSheetScenario(options = {}, groups = 0) {
  const native = axScenario(options);
  const element = (role, parent, attrs = {}) => ({type: 'AX', pid: 123,
    attrs: {AXRole: native.string(role), AXParent: parent, ...attrs}});
  const root = element('AXWindow', native.app, {AXTitle: native.string('Ibis')});
  native.panel.attrs.AXRole = native.string('AXSheet');
  native.panel.attrs.AXTitle = native.string('Open'); // Nonmatching need not mean empty.
  native.panel.attrs.AXParent = root;
  root.attrs.AXChildren = native.array([native.panel]);
  native.app.attrs.AXWindows = native.array([root]);
  let parent = native.panel;
  for (let index = 0; index < groups; index++) {
    const group = element('AXGroup', parent);
    if (parent === native.panel) parent.attrs.AXChildren.value.push(group);
    else parent.attrs.AXChildren = native.array([group]);
    parent = group;
  }
  const header = element('AXStaticText', parent, {AXValue: native.string('Choose a BibTeX or BibLaTeX library')});
  if (parent === native.panel) parent.attrs.AXChildren.value.push(header);
  else parent.attrs.AXChildren = native.array([header]);
  return Object.assign(native, {root, header, headerParent: parent, element});
}

test('the legacy untitled direct sheet accepts one owned fixed banner through structural groups only', () => {
  for (const groups of [0, 1]) {
    const native = untitledSheetScenario({}, groups);
    assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
    native.setPathOpen(false);
    native.panel.attrs.AXChildren.value.push(groups === 0 ? native.header : native.headerParent);
    assert.deepEqual(native.call('after-location', identity()), {ready: true, closed: false});
    assert.equal(native.posted.length, 0);
  }
});

test('banner fallback refuses foreign, wrong, browser-only, duplicate and detached header proofs', () => {
  const wrong = untitledSheetScenario(); wrong.header.attrs.AXValue = wrong.string('Other chooser');
  assert.equal(wrong.call('location-identity').ready, false);
  const foreign = untitledSheetScenario(); foreign.header.pid = 456;
  assert.throws(() => foreign.call('location-identity'), /ownership/);
  const browser = untitledSheetScenario();
  browser.panel.attrs.AXChildren.value.pop(); browser.browser.attrs.AXChildren = browser.array([browser.header]);
  assert.equal(browser.call('location-identity').ready, false);
  assert.equal(browser.reads.filter(([name, attr]) => name === 'count' && attr === 'AXChildren').length, 2,
    'Read root and sheet children, never the file browser');
  const duplicate = untitledSheetScenario();
  duplicate.panel.attrs.AXChildren.value.push(duplicate.element('AXStaticText', duplicate.panel,
    {AXValue: duplicate.string('Choose a BibTeX or BibLaTeX library')}));
  assert.throws(() => duplicate.call('location-identity'), /ambiguous/);
  const detached = untitledSheetScenario(); detached.panel.attrs.AXParent = detached.app;
  assert.throws(() => detached.call('location-identity'), /parent|ownership/);
  for (const native of [wrong, foreign, browser, duplicate, detached]) assert.equal(native.posted.length, 0);
});

test('banner discovery cannot accept a partial header before a cycle, node bound or AX budget failure', () => {
  const cycle = untitledSheetScenario({}, 1);
  cycle.headerParent.attrs.AXChildren.value.push(cycle.headerParent);
  assert.throws(() => cycle.call('location-identity'), /cyclic|parent|bound/);
  const large = untitledSheetScenario();
  large.panel.attrs.AXChildren.value.push(...Array.from({length: 17}, () => large.element('AXButton', large.panel)));
  assert.throws(() => large.call('location-identity'), /bound/);
  const deep = untitledSheetScenario({}, 4);
  assert.throws(() => deep.call('location-identity'), /bound|budget/);
  const budget = untitledSheetScenario({callMilliseconds: 250});
  assert.throws(() => budget.call('location-identity'), /budget/);
  for (const native of [cycle, large, deep, budget]) assert.equal(native.posted.length, 0);
});

test('banner fallback requires the owning app window relation and does not broaden root roles', () => {
  const native = untitledSheetScenario(); native.root.attrs.AXRole = native.string('AXSheet');
  assert.equal(native.call('location-identity').ready, false);
  assert.equal(native.posted.length, 0);
});


test('the exact-object AX identity cache expires per helper and never accepts a new equal-looking foreign wrapper', () => {
  const native = axScenario();
  assert.equal(native.call('location-identity').ready, true);
  assert.equal(native.pidReads.filter(value => value === native.panel).length, 1,
    'Repeated attributes reuse only the already checked exact native object');
  assert.equal(native.call('location-identity').ready, true);
  assert.equal(native.pidReads.filter(value => value === native.panel).length, 2,
    'A new observation validates again');
  const foreign = {type: 'AX', pid: 456, nativeObject: true, isNil: () => false,
    nativeRef: native.panel, attrs: native.field.attrs}; // CFEqual would alias the old panel.
  native.app.attrs.AXFocusedUIElement = foreign;
  assert.throws(() => native.call('location-identity'), /ownership/);
  assert.equal(native.posted.length, 0);
  const expired = axScenario(); assert.equal(expired.call('location-identity').ready, true);
  expired.field.pid = 456;
  assert.throws(() => expired.call('location-identity'), /ownership/);
});

test('cached AX identities cannot suppress fresh attribute errors or the 256-call observation cap', () => {
  const stale = axScenario({onRead: (api, name, attr) => { if (attr === 'AXFocused') api.fail(attr); }});
  assert.throws(() => stale.call('location-identity'), /AX observation failed/);
  assert.equal(stale.posted.length, 0);
  const large = untitledSheetScenario();
  large.panel.attrs.AXChildren = large.array(Array.from({length: 16}, (_, index) =>
    large.element('AXStaticText', large.panel, {AXValue: large.string(index === 0 ?
      'Choose a BibTeX or BibLaTeX library' : 'Synthetic other header')})));
  assert.throws(() => large.call('location-identity'), /budget/);
  assert.equal(large.diagnostics.at(-1).reason, 'budget-exceeded');
  assert.equal(large.posted.length, 0);
});
