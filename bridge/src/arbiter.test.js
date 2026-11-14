import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArbiter } from './arbiter.js';

function setup() {
  let t = 0;
  const switches = [];
  const arb = createArbiter({ timeoutMs: 500, now: () => t, onSwitch: (to, from) => switches.push([from, to]) });
  return { arb, switches, at: (ms) => (t = ms) };
}

test('first source becomes active', () => {
  const { arb, switches } = setup();
  assert.equal(arb.active, null);
  assert.equal(arb.offer('studio'), true);
  assert.equal(arb.active, 'studio');
  assert.deepEqual(switches, [[null, 'studio']]);
});

test('drops the other source while the active one streams', () => {
  const { arb, switches, at } = setup();
  arb.offer('studio');
  at(100);
  assert.equal(arb.offer('sdk'), false);
  at(400);
  assert.equal(arb.offer('studio'), true);
  at(800);
  assert.equal(arb.offer('sdk'), false); // studio last seen 400 ms ago
  assert.equal(arb.active, 'studio');
  assert.equal(switches.length, 1);
});

test('falls back after the active source goes silent', () => {
  const { arb, switches, at } = setup();
  arb.offer('studio');
  at(501);
  assert.equal(arb.offer('sdk'), true);
  assert.equal(arb.active, 'sdk');
  at(600);
  assert.equal(arb.offer('studio'), false); // sdk is streaming now
  assert.deepEqual(switches, [[null, 'studio'], ['studio', 'sdk']]);
});
