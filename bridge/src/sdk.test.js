import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { buildStudioFrame, jointsFromRgmp, normaliseJointName, OPENXR_JOINTS, qMul, synthOpenXrHand } from './openxr-hand.js';
import { compileDefinition, decodeData, encodeFrame, MSG_DEFINITION, MSG_DISCONNECT, parseDataType, RgmpParser } from './rgmp.js';
import { connectSdk } from './sdk-client.js';
import { dataFrameFor, definitionFor } from './fake-sdk.js';

const glove = { id: 7, side: 'right' };

test('data types', () => {
  assert.equal(parseDataType('FLOAT[7]').size, 28);
  assert.equal(parseDataType('DOUBLE[3,3]').count, 9);
  assert.equal(parseDataType('UINT32').size, 4);
  assert.throws(() => parseDataType('WAT[2]'));
});

test('RGMP parser handles byte-by-byte chunks, groups by name, and disconnects', () => {
  const events = [];
  const p = new RgmpParser({
    onDefinition: (id) => events.push(['def', id]),
    onData: (d) => events.push(['data', d.deviceId, d.group.name, d.values.length, d.timestampUs]),
    onDisconnect: (id) => events.push(['bye', id]),
  });
  const joints = synthOpenXrHand('right', [0.5, 0.5, 0.5, 0.5, 0.5]);
  const disconnect = Buffer.alloc(4);
  disconnect.writeUInt32LE(7);
  const stream = Buffer.concat([
    encodeFrame(MSG_DEFINITION, Buffer.from(JSON.stringify(definitionFor(glove)))),
    encodeFrame(99, Buffer.from('future frame type, must be ignored')),
    dataFrameFor(glove, joints, 123456),
    encodeFrame(MSG_DISCONNECT, disconnect),
  ]);
  for (const b of stream) p.push(Buffer.from([b]));
  assert.deepEqual(events, [['def', 7], ['data', 7, 'joints_openxr', 26, 123456], ['bye', 7]]);
});

test('joint names: Rokoko xr_ names, OpenXR enum names, and index-order fallback', () => {
  assert.equal(normaliseJointName('xr_index_proximal'), 'index_proximal');
  assert.equal(normaliseJointName('XR_HAND_JOINT_LITTLE_TIP_EXT'), 'little_tip');
  assert.equal(normaliseJointName('pinky_distal'), 'little_distal');
  const def = definitionFor(glove);
  def.groups[1].streams.forEach((s, i) => (s.target_frame = `joint${i}`)); // unrecognised names
  const compiled = compileDefinition(def);
  const payload = dataFrameFor(glove, synthOpenXrHand('right', [0, 0, 0, 0, 0]), 0).subarray(8);
  const joints = jointsFromRgmp(decodeData(payload, compiled));
  assert.deepEqual([...joints.keys()], OPENXR_JOINTS);
});

// Relative rotation angle between two Studio joints (what the web app measures).
function relAngle(a, b) {
  const qa = [a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w];
  const qb = [b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w];
  const r = qMul([-qa[0], -qa[1], -qa[2], qa[3]], qb);
  return 2 * Math.acos(Math.min(1, Math.abs(r[3])));
}
function flexSum(body, side, finger) {
  const j = (p) => body[`${side}${finger}${p}`];
  return relAngle(body[`${side}Hand`], j('Proximal')) + relAngle(j('Proximal'), j('Medial')) + relAngle(j('Medial'), j('Distal'));
}

test('solved hands become Studio JSON v3 with finger flexion preserved', () => {
  for (const side of ['left', 'right']) {
    const toJoints = (c) => new Map(synthOpenXrHand(side, [c, c, c, c, c]).map((j) => [j.name, { p: j.p, q: j.q }]));
    const open = buildStudioFrame({ [side]: toJoints(0) }, 0);
    const fist = buildStudioFrame({ [side]: toJoints(1) }, 0);
    const actor = fist.scene.actors[0];
    assert.equal(actor.meta.hasGloves, true);
    assert.equal(actor.meta[side === 'left' ? 'hasLeftGlove' : 'hasRightGlove'], true);
    assert.equal(actor.senecai.positions, 'wrist-relative');
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      assert.ok(flexSum(open.scene.actors[0].body, side, finger) < 0.01, `${side} ${finger} open`);
      // 1.4 + 1.65 + 1.05 rad of synthetic flexion at curl = 1
      assert.ok(Math.abs(flexSum(actor.body, side, finger) - 4.1) < 0.01, `${side} ${finger} fist`);
    }
  }
});

test('end to end: fake solver -> sdk client -> Studio frames, sides from device_info', async () => {
  const server = net.createServer((sock) => {
    for (const g of [{ id: 1, side: 'left' }, { id: 2, side: 'right' }]) {
      sock.write(encodeFrame(MSG_DEFINITION, Buffer.from(JSON.stringify(definitionFor(g)))));
      sock.write(dataFrameFor(g, synthOpenXrHand(g.side, [0.2, 0.4, 0.6, 0.8, 1]), 1000));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const frame = await new Promise((resolve) => {
    const client = connectSdk({ port: server.address().port, log: () => {}, onFrame: (f) => (client.close(), resolve(f)) });
  });
  server.close();
  const body = frame.scene.actors[0].body;
  assert.ok(body.leftHand && body.rightHand && body.rightLittleTip && body.leftThumbProximal);
  assert.ok(flexSum(body, 'right', 'Little') > flexSum(body, 'right', 'Index'));
});
