const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { unique, flags, locationFlags, validateToken, locationProgress } = require('./dialog-macos.js');

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
    ObjC: {import: () => {}, deepUnwrap: value => value, castRefToObject: value => value},
    Application: () => {
      if (forbidAX) throw Error('No AX traversal after Go To Folder closes');
      return {applicationProcesses: {whose: () => () => [{windows: () => duplicate ? [window, window] : [window]}]}};
    },
    $: Object.assign(value => ({dataUsingEncoding: () => value}), {
      NSFileHandle: {fileHandleWithStandardError: {writeData: () => {}}},
      AXIsProcessTrusted: () => true,
      NSRunningApplication: {runningApplicationWithProcessIdentifier: () => ({isTerminated: false, launchDate: {timeIntervalSince1970: 7}})},
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
  return {call: (action, token) => JSON.parse(context.run([action, '123', JSON.stringify(token)])), presses: () => presses,
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

const identity = () => ({owner: {pid: 123, started: 7},
  panel: {window: 10, bounds: {X: 10, Y: 20, Width: 500, Height: 400}},
  sheet: {window: 20, bounds: {X: 15, Y: 25, Width: 450, Height: 120}}});
const surface = (part, owner = 123) => ({kCGWindowNumber: part.window, kCGWindowOwnerPID: owner,
  kCGWindowAlpha: 1, kCGWindowBounds: {...part.bounds}});

test('path identity requires two distinct verified physical windows before any typing', () => {
  const native = nativeScenario({location: true, physicalSheet: true});
  assert.deepEqual(native.call('location-identity'), {ready: true, owned: true, token: identity()});
  assert.throws(() => nativeScenario({location: true}).call('location-identity'), /identity metadata/);
  assert.deepEqual(nativeScenario().call('location-identity'), {ready: false, owned: true, token: null});
});

test('physical identity rejects malformed, foreign and identical window tokens', () => {
  for (const token of [null, {}, {...identity(), payload: 'private'},
    {...identity(), owner: {pid: 456, started: 7}}, {...identity(), owner: {pid: 123, started: true}},
    {...identity(), sheet: identity().panel}, {...identity(), panel: {window: 2 ** 40, bounds: identity().panel.bounds}}]) {
    assert.throws(() => validateToken(token, 123), /metadata/);
  }
});

test('fresh CG closure never comes from an unavailable list or reused foreign ID', () => {
  const token = identity();
  for (const windows of [null, [{}], [surface(token.panel, 456)], [surface(token.sheet, 456)],
    [{...surface(token.panel), kCGWindowAlpha: NaN}]]) {
    assert.throws(() => locationProgress(windows, token, true), /metadata|identity|ownership/);
  }
  assert.deepEqual(locationProgress([surface(token.sheet), surface(token.panel)], token, true), {ready: false, closed: false});
  assert.deepEqual(locationProgress([surface(token.panel)], token, false), {ready: false, closed: false});
  assert.deepEqual(locationProgress([], token, false), {ready: true, closed: true});
});

test('changed frame, duplicate identities or another owned surface cannot authorize Return', () => {
  const token = identity(), panel = surface(token.panel);
  assert.throws(() => locationProgress([{...panel, kCGWindowBounds: {...panel.kCGWindowBounds, X: 50}}], token, true), /frame/);
  assert.throws(() => locationProgress([panel, panel], token, true), /ambiguous/);
  const other = {...panel, kCGWindowNumber: 99};
  assert.deepEqual(locationProgress([other, panel], token, true), {ready: false, closed: false});
  assert.deepEqual(locationProgress([panel, other], token, true), {ready: true, closed: false});
});

test('post-path polling and one balanced Return use only fresh CG facts without AX traversal', () => {
  const token = identity(), panel = surface(token.panel);
  const native = nativeScenario({forbidAX: true, tokenWindows: [surface(token.sheet), panel]});
  assert.deepEqual(native.call('after-location', token), {ready: false, closed: false});
  assert.throws(() => native.call('confirm-key', token), /not ready/);
  assert.equal(native.posted.length, 0);
  native.setWindows([panel]);
  assert.deepEqual(native.call('after-location', token), {ready: true, closed: false});
  assert.deepEqual(native.call('confirm-key', token), {invoked: true});
  assert.deepEqual(native.posted, [{code: 36, down: true, flags: 0}, {code: 36, down: false, flags: 0}]);
  native.setWindows([]);
  assert.deepEqual(native.call('after-location', token), {ready: true, closed: true});
  assert.throws(() => native.call('confirm-key', token), /not ready/);
  assert.equal(native.posted.length, 2);
});

test('a keyboard posting failure releases once and never retries the action', () => {
  const token = identity();
  const native = nativeScenario({forbidAX: true, tokenWindows: [surface(token.panel)], postFailure: true});
  assert.throws(() => native.call('confirm-key', token), error => error.message === 'Native dialog keyboard action failed');
  assert.equal(native.posted.length, 2);
  assert.equal(native.posted[1].down, false);
});

test('ownership is revalidated after event preparation immediately before posting', () => {
  const token = identity();
  const native = nativeScenario({forbidAX: true, tokenWindows: [surface(token.panel)],
    onPrepare: () => native.setWindows([surface(token.panel, 456)])});
  assert.throws(() => native.call('confirm-key', token), /ownership changed/);
  assert.equal(native.posted.length, 0);
});
