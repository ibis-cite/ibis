const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { unique, flags, locationFlags } = require('./dialog-macos.js');

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

function nativeScenario({owner = 123, foreground = 123, duplicate = false, pressFailure = false, location = false, duplicateLocation = false, forbidBrowserTraversal = false, windowTitle = 'Choose a BibTeX or BibLaTeX library', attached = false} = {}) {
  let presses = 0, windowValueReads = 0;
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
  const window = node(windowTitle, 'AXWindow', false,
    location ? [open, cancel, focus, sheet, field] : [open, cancel, focus]);
  window.value = () => { windowValueReads++; return ''; };
  window.sheets = () => location ? (duplicateLocation ? [sheet, sheet] : [sheet]) : [];
  if (attached) {
    const dialog = node('Choose a BibTeX or BibLaTeX library', 'AXSheet', false,
      location ? [open, cancel, focus, sheet, field] : [open, cancel, focus]);
    dialog.sheets = window.sheets;
    window.name = () => 'Ibis'; window.title = () => 'Ibis';
    window.sheets = () => duplicate ? [dialog, dialog] : [dialog];
  }
  if (forbidBrowserTraversal) window.entireContents = () => { throw Error('Do not enumerate the file browser to poll its path sheet'); };
  const metadata = [{kCGWindowOwnerPID: owner, kCGWindowAlpha: 1,
    kCGWindowBounds: {X: 10, Y: 20, Width: 500, Height: 400}}];
  const context = {
    module: {exports: {}},
    ObjC: {import: () => {}, deepUnwrap: value => value, castRefToObject: value => value},
    Application: () => ({applicationProcesses: {whose: () => () => [{windows: () => duplicate ? [window, window] : [window]}]}}),
    $: Object.assign(value => ({dataUsingEncoding: () => value}), {
      NSFileHandle: {fileHandleWithStandardError: {writeData: () => {}}},
      AXIsProcessTrusted: () => true,
      NSRunningApplication: {runningApplicationWithProcessIdentifier: () => ({terminated: false})},
      NSWorkspace: {sharedWorkspace: {frontmostApplication: {processIdentifier: foreground}}},
      CGWindowListCopyWindowInfo: () => metadata, CFArrayGetCount: refs => refs.length,
      CFArrayGetValueAtIndex: (refs, index) => refs[index],
    }),
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./dialog-macos.js'), 'utf8'), context);
  return {call: action => JSON.parse(context.run([action, '123', '0'])), presses: () => presses,
    windowValueReads: () => windowValueReads};
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
