const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {ObjC: {import() {}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${__dirname}/smoke-macos.js`, 'utf8'), context);

const events = [];
context.sendPhysicalChord('ctrl+super+r', (...event) => events.push(event));
assert.deepEqual(events, [
    [59, true, 1 << 18], [55, true, (1 << 18) | (1 << 20)],
    [15, true, (1 << 18) | (1 << 20)], [15, false, (1 << 18) | (1 << 20)],
    [55, false, 1 << 18], [59, false, 0],
]);

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
context.$ = {CGPreflightPostEventAccess: () => true, CGEventSourceCreate: () => null};
assert.throws(() => context.run(['key', '42', '0', 'escape']), /Native HID event source unavailable/);

const posted = [];
context.$ = Object.assign(character => ({dataUsingEncoding: () => {
    const bytes = Buffer.from(character, 'utf16le');
    return {length: bytes.length, bytes};
}}), {
    CGPreflightPostEventAccess: () => true, CGEventSourceCreate: () => ({}),
    CGEventCreateKeyboardEvent: (_source, code, down) => ({code, down}),
    CGEventSetFlags: (event, flags) => { event.flags = flags; },
    CGEventKeyboardSetUnicodeString: (event, length, bytes) => {
        assert.equal(bytes.length, length * 2);
        event.text = bytes.toString('utf16le');
    },
    kCGHIDEventTap: 9,
    CGEventPost: (tap, event) => { assert.equal(tap, 9); posted.push(event); },
});
context.run(['text', '42', '0', '汉😀']);
assert.deepEqual(posted.map(event => [event.text, event.down, event.flags]), [
    ['汉', true, 0], ['汉', false, 0], ['😀', true, 0], ['😀', false, 0],
]);
console.log('Native HID event-plan contracts passed; no macOS execution claimed.');
