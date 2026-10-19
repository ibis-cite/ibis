const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {ObjC: {import() {}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/smoke-macos.js`, 'utf8'), context);

const fullscreenRead = () => context.readEditorFullscreen(() => { throw Error('Synthetic transition AX getter failure'); });
assert.equal(JSON.stringify(fullscreenRead()), '{"available":false,"fullscreen":null}');
assert.equal(JSON.stringify(context.readEditorFullscreen(() => false)), '{"available":true,"fullscreen":false}');
assert.equal(JSON.stringify(context.readEditorFullscreen(() => true)), '{"available":true,"fullscreen":true}');
let fullscreenReads = 0;
const settlingFullscreen = () => {
    fullscreenReads++;
    if (fullscreenReads === 1) throw Error('Synthetic transition AX getter failure');
    return false;
};
assert.equal(context.readEditorFullscreen(settlingFullscreen).available, false);
assert.equal(JSON.stringify(context.readEditorFullscreen(settlingFullscreen)), '{"available":true,"fullscreen":false}');
assert.equal(fullscreenReads, 2);
for (const malformed of [null, undefined, 0, 'false']) {
    assert.throws(() => context.readEditorFullscreen(() => malformed), /Editor fullscreen accessibility state unavailable/);
}

// Execute the real setter with changing AX/CG observations, rather than
// asserting its source spelling. All native calls below are synthetic.
function fullscreenScenario(samples, visibility = [true]) {
    let elapsed = 0, reads = 0, writes = 0, visibleReads = 0, windowCount = 1;
    const attribute = {};
    Object.defineProperty(attribute, 'value', {
        get: () => () => {
            const value = samples[Math.min(reads++, samples.length - 1)];
            if (value instanceof Error) throw value;
            return value;
        },
        set: () => { writes++; },
    });
    const window = {attributes: {byName: () => attribute}, position: () => [10, 20], size: () => [500, 400]};
    const native = {
        ObjC: {import() {}, deepUnwrap: value => value, castRefToObject: value => value},
        Date: {now: () => elapsed},
        Application: () => ({applicationProcesses: {whose: () => () => [{windows: () => Array(windowCount).fill(window)}]}}),
        $: {
            NSThread: {sleepForTimeInterval: seconds => { elapsed += seconds * 1000; }},
            CGWindowListCopyWindowInfo: () => visibility[Math.min(visibleReads++, visibility.length - 1)] ?
                [{kCGWindowOwnerPID: 456, kCGWindowAlpha: 1, kCGWindowBounds: {X: 10, Y: 20, Width: 500, Height: 400}}] : [],
            CFArrayGetCount: value => value.length, CFArrayGetValueAtIndex: (value, index) => value[index],
        },
    };
    vm.createContext(native);
    vm.runInContext(fs.readFileSync(`${__dirname}/smoke-macos.js`, 'utf8'), native);
    return {run: () => JSON.parse(native.run(['set-editor-fullscreen', '123', '456', 'false'])),
        reads: () => reads, writes: () => writes, elapsed: () => elapsed,
        duplicate: () => { windowCount = 2; }};
}
const changing = fullscreenScenario([true, false, true]);
assert.deepEqual(changing.run(), {fullscreen: false, visible: true});
assert.equal(changing.reads(), 2, 'Return the accepted AX/CG sample; a fresh final read could regress');
assert.equal(changing.writes(), 1);
const unknownThenReady = fullscreenScenario([true, new Error('Synthetic transition getter'), false]);
assert.deepEqual(unknownThenReady.run(), {fullscreen: false, visible: true});
assert.ok(unknownThenReady.elapsed() > 0);
for (const sample of [true, new Error('Synthetic unknown transition')]) {
    const timeout = fullscreenScenario([true, sample]);
    assert.throws(timeout.run, /transition did not complete on screen/);
    assert.equal(timeout.elapsed(), 20000, 'Unknown or false readiness uses the original deadline');
}
const hidden = fullscreenScenario([true, false], [false]);
assert.throws(hidden.run, /transition did not complete on screen/);
const duplicates = fullscreenScenario([true, false]); duplicates.duplicate();
assert.throws(duplicates.run, /single synthetic editor window/);

const events = [];
context.sendPhysicalChord('ctrl+super+r', (...event) => events.push(event));
assert.deepEqual(events, [
    [59, true, 1 << 18], [55, true, (1 << 18) | (1 << 20)],
    [15, true, (1 << 18) | (1 << 20)], [15, false, (1 << 18) | (1 << 20)],
    [55, false, 1 << 18], [59, false, 0],
]);

const goToFolder = [];
context.sendPhysicalChord('super+shift+g', (...event) => goToFolder.push(event));
assert.deepEqual(goToFolder, [
    [55, true, 1 << 20], [56, true, (1 << 20) | (1 << 17)],
    [5, true, (1 << 20) | (1 << 17)], [5, false, (1 << 20) | (1 << 17)],
    [56, false, 1 << 20], [55, false, 0],
]);

const pastePath = [];
context.sendPhysicalChord('super+v', (...event) => pastePath.push(event));
assert.deepEqual(pastePath, [[55, true, 1 << 20], [9, true, 1 << 20], [9, false, 1 << 20], [55, false, 0]]);

const failed = [];
assert.throws(() => context.sendPhysicalChord('ctrl+shift+space', (code, down, flags) => {
    failed.push([code, down, flags]);
    if (code === 49 && down) throw Error('Synthetic event-creation failure');
}), /Synthetic event-creation failure/);
assert.deepEqual(failed.slice(-3), [[49, false, (1 << 18) | (1 << 17)], [56, false, 1 << 18], [59, false, 0]]);

const cleanup = [];
assert.throws(() => context.sendPhysicalChord('ctrl+super+r', (code, down, flags) => {
    cleanup.push([code, down, flags]);
    if (code === 55 && !down) throw Error('Synthetic modifier-release failure');
}), /Synthetic modifier-release failure/);
assert.deepEqual(cleanup.at(-1), [59, false, 0]);

const text = [];
context.sendUnicodeText('a汉😀', (...event) => text.push(event));
assert.deepEqual(text.map(event => [event[1], event[3], event[3].length]), [
    [true, 'a', 1], [false, 'a', 1], [true, '汉', 1], [false, '汉', 1],
    [true, '😀', 2], [false, '😀', 2],
]);
assert.ok(text.every(event => event[0] === 0 && event[2] === 0));
assert.throws(() => context.sendPhysicalChord('ctrl+unknown', () => assert.fail('Invalid chord emitted an event')), /Unsupported/);

context.Application = () => ({});
context.$ = {AXIsProcessTrusted: () => true, CGPreflightPostEventAccess: () => false};
assert.throws(() => context.run(['probe', '42', '0', '']), /TCC event posting is not granted/);
context.Application = () => ({applicationProcesses: []});
context.$ = {AXIsProcessTrusted: () => true};
let bound = false;
context.ObjC.bindFunction = (name, signature) => {
    assert.equal(name, 'CGPreflightPostEventAccess');
    assert.equal(JSON.stringify(signature), '["bool",[]]');
    bound = true;
    context.$.CGPreflightPostEventAccess = () => true;
};
assert.equal(context.run(['probe', '42', '0', '']), 'true');
assert.equal(bound, true);
context.$ = {AXIsProcessTrusted: () => true};
context.ObjC.bindFunction = () => { throw Error('Synthetic missing native symbol'); };
assert.throws(() => context.run(['probe', '42', '0', '']), /Native event-posting preflight unavailable/);
context.$ = {CGPreflightPostEventAccess: () => true, CGEventSourceCreate: () => null};
assert.throws(() => context.run(['key', '42', '0', 'escape']), /Native HID event source unavailable/);

const posted = [];
let unicodeBindings = 0;
context.ObjC.bindFunction = (name, signature) => {
    assert.equal(name, 'CGEventKeyboardSetUnicodeString');
    assert.equal(JSON.stringify(signature), '["void",["void *","unsigned long","void *"]]');
    unicodeBindings++;
    context.$.CGEventKeyboardSetUnicodeString = (event, length, bytes) => {
        assert.equal(bytes.length, length * 2);
        event.text = bytes.toString('utf16le');
    };
};
context.$ = Object.assign(character => ({dataUsingEncoding: () => {
    const bytes = Buffer.from(character, 'utf16le');
    return {length: bytes.length, bytes};
}}), {
    CGPreflightPostEventAccess: () => true, CGEventSourceCreate: () => ({}),
    CGEventCreateKeyboardEvent: (_source, code, down) => ({code, down}),
    CGEventSetFlags: (event, flags) => { event.flags = flags; },
    CGEventKeyboardSetUnicodeString: () => { throw Error('Ref has incompatible type'); },
    kCGHIDEventTap: 9,
    CGEventPost: (tap, event) => { assert.equal(tap, 9); posted.push(event); },
});
context.run(['text', '42', '0', '汉😀']);
assert.equal(unicodeBindings, 1);
assert.deepEqual(posted.map(event => [event.text, event.down, event.flags]), [
    ['汉', true, 0], ['汉', false, 0], ['😀', true, 0], ['😀', false, 0],
]);
console.log('Native HID event-plan contracts passed; no macOS execution claimed.');
