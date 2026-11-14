import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArbiter, hasHandData } from './arbiter.js';
import { buildGloveFrame } from './synthetic-frame.js';
import { buildStudioFrame, synthOpenXrHand } from './openxr-hand.js';

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

test('a source without hands cannot claim or keep the feed', () => {
  const { arb, switches, at } = setup();
  // Studio streams actors without gloves first; the SDK still gets the feed.
  assert.equal(arb.offer('studio', false), true); // nobody has hands: forwarded for the actor list
  assert.equal(arb.active, null);
  at(10);
  assert.equal(arb.offer('sdk', true), true);
  assert.equal(arb.active, 'sdk');
  at(20);
  assert.equal(arb.offer('studio', false), false); // dropped while the SDK has hands
  assert.deepEqual(switches, [[null, 'sdk']]);
});

test('hand-less frames from the active source are forwarded but do not refresh it', () => {
  const { arb, switches, at } = setup();
  arb.offer('studio', true);
  at(100);
  assert.equal(arb.offer('studio', false), true); // browser sees the hands disappear
  at(400);
  assert.equal(arb.offer('studio', false), true);
  assert.equal(arb.offer('sdk', true), false); // studio had hands 400 ms ago
  at(501);
  assert.equal(arb.offer('studio', false), true); // still last to claim, nobody else live
  at(502);
  assert.equal(arb.offer('sdk', true), true); // studio's last hands were 502 ms ago
  assert.equal(arb.active, 'sdk');
  at(510);
  assert.equal(arb.offer('studio', false), false);
  assert.deepEqual(switches, [[null, 'studio'], ['studio', 'sdk']]);
});

test('while nobody has hands, one idle source is forwarded', () => {
  const { arb, at } = setup();
  assert.equal(arb.offer('studio', false), true);
  at(100);
  assert.equal(arb.offer('sdk', false), false); // studio keeps the idle slot
  assert.equal(arb.offer('studio', false), true);
  at(700);
  assert.equal(arb.offer('sdk', false), true); // studio silent > 500 ms
  at(710);
  assert.equal(arb.offer('studio', false), false);
  assert.equal(arb.offer('studio', true), true); // hands always win over idle frames
  assert.equal(arb.offer('sdk', false), false);
});

test('hasHandData detects hands in Studio JSON v3 frames', () => {
  assert.equal(hasHandData(buildGloveFrame(0)), true);
  const noGloves = buildGloveFrame(0);
  Object.assign(noGloves.scene.actors[0].meta, { hasGloves: false, hasLeftGlove: false, hasRightGlove: false });
  assert.equal(hasHandData(noGloves), false);
  const leftOnly = buildGloveFrame(0);
  leftOnly.scene.actors[0].meta.hasRightGlove = false;
  assert.equal(hasHandData(leftOnly), true);
  const noFingers = buildGloveFrame(0);
  for (const k of Object.keys(noFingers.scene.actors[0].body)) if (!k.endsWith('Hand')) delete noFingers.scene.actors[0].body[k];
  assert.equal(hasHandData(noFingers), false);
  assert.equal(hasHandData({ version: 3, scene: { timestamp: 0, actors: [{ name: 'Body only', meta: {}, body: {} }], props: [] } }), false);
  assert.equal(hasHandData({ version: 3, scene: { timestamp: 0, actors: [], props: [] } }), false);
  assert.equal(hasHandData(null), false);
  assert.equal(hasHandData(buildStudioFrame({}, 0)), false);
  assert.equal(hasHandData(buildStudioFrame({ right: new Map(synthOpenXrHand('right', [0.5, 0.5, 0.5, 0.5, 0.5]).map((j) => [j.name, { p: j.p, q: j.q }])) }, 0)), true);
});
