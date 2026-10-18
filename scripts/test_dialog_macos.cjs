const test = require('node:test');
const assert = require('node:assert/strict');
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
