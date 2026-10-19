const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { unique, flags, locationFlags, validateToken, locationProgress } = require('./dialog-macos.js');
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
  const button = ax('AXButton', {AXParent: panel, AXTitle: string('Open'), AXEnabled: bool(true)});
  const browser = ax('AXOutline', {AXParent: panel});
  const app = ax('AXApplication', {AXWindows: array([panel]), AXFocusedUIElement: field});
  const system = ax('AXSystemWide');
  const unknown = ax('AXSheet', {AXParent: panel, ...frames(sheetBounds)});
  let windows = [{kCGWindowNumber: 10, kCGWindowOwnerPID: 123, kCGWindowAlpha: 1, kCGWindowBounds: panelBounds}];
  let foreground = 123, processPid = 123, processExecutable = executable, registered = true, terminated = false, elapsed = 0, failure = null;
  const timeouts = [], posted = [], reads = [], stages = [], diagnostics = [];
  const status = (name, attribute) => {
    reads.push([name, attribute]);
    if (options.onRead) options.onRead(api, name, attribute);
    if (options.nativeThrow) throw Error('private native payload');
    elapsed += options.callMilliseconds || 0;
    return failure && (!failure.attribute || failure.attribute === attribute) ? failure.code : 0;
  };
  const read = (element, attribute, output) => {
    const name = attribute.value;
    const error = status('read', name);
    if (error) return error;
    if (!(name in element.attrs)) return -25205;
    output[0] = element.attrs[name]; return 0;
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
      castRefToObject: value => value, bindFunction() { throw Error('Missing ABI binding'); }},
    $: Object.assign(string, {
      NSFileHandle: {fileHandleWithStandardError: {writeData(value) {
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
        const count = Array.isArray(refs) ? refs.length : refs.value.length;
        return options.stringLong ? String(count) : count;
      },
      CFArrayGetValueAtIndex: (refs, index) => Array.isArray(refs) ? refs[index] : refs.value[index],
      CFGetTypeID: value => {
        if (Object.hasOwn(options, 'actualTypeId')) return options.actualTypeId;
        return options.actualTypeIdsAsStrings ? String(types[value.type]) : types[value.type];
      }, CFStringGetTypeID: () => types.string,
      CFBooleanGetTypeID: () => types.bool, CFArrayGetTypeID: () => types.array,
      CFBooleanGetValue: value => options.numericBoolean ? Number(value.value) : value.value,
      CFEqual: (left, right) => options.numericBoolean ? Number(left === right) : left === right,
      AXUIElementGetTypeID: () => options.expectedTypeIdsAsStrings ? String(types.AX) : types.AX,
      AXValueGetTypeID: () => options.expectedTypeIdsAsStrings ? String(types.value) : types.value,
      AXUIElementCreateSystemWide: () => options.nilSystem ? null : system, AXUIElementCreateApplication: () => app,
      AXUIElementSetMessagingTimeout: (element, seconds) => { timeouts.push([element, seconds]); return options.timeoutFailure ? -25201 : 0; },
      AXUIElementGetPid: (element, output) => { output[0] = element.pid; return 0; },
      AXUIElementCopyAttributeValue: read,
      AXUIElementGetAttributeValueCount: (element, attribute, output) => {
        const error = status('count', attribute.value);
        if (error) return error;
        const value = element.attrs[attribute.value];
        if (!value || value.type !== 'array') return -25205;
        output[0] = options.stringLong ? String(value.value.length) : value.value.length; return 0;
      },
      AXUIElementCopyAttributeValues: (element, attribute, index, maximum, output) => {
        const error = status('array', attribute.value);
        if (error) return error;
        const value = element.attrs[attribute.value];
        if (!value || value.type !== 'array') return -25205;
        output[0] = array(value.value.slice(index, index + maximum)); return 0;
      },
      CGPointMake: (x, y) => ({x, y}), CGSizeMake: (width, height) => ({width, height}),
      AXValueGetType: value => value.kind,
      AXValueGetValue: (value, kind, output) => {
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
  const api = {panel, sheet, field, button, browser, app, unknown, posted, timeouts, reads, stages, diagnostics, system, bool, array, string,
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
