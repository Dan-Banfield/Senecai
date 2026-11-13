import { test } from 'node:test';
import assert from 'node:assert/strict';
import lz4 from 'lz4js';
import { decodeDatagram } from './decode.js';
import { buildGloveFrame } from './synthetic-frame.js';

const json = JSON.stringify(buildGloveFrame(1.23));

test('plain JSON v3', () => {
  const r = decodeDatagram(Buffer.from(json));
  assert.equal(r.ok, true);
  assert.equal(r.compression, 'none');
  assert.ok(r.frame.scene.actors[0].body.rightIndexProximal);
});

test('LZ4 frame JSON v3', () => {
  const r = decodeDatagram(Buffer.from(lz4.compress(Buffer.from(json))));
  assert.equal(r.ok, true);
  assert.equal(r.compression, 'lz4-frame');
});

test('raw LZ4 block JSON v3', () => {
  const src = Buffer.from(json);
  const dst = new Uint8Array(lz4.compressBound(src.length));
  const n = lz4.compressBlock(src, dst, 0, src.length, new Array(1 << 16).fill(0));
  const r = decodeDatagram(Buffer.from(dst.subarray(0, n)));
  assert.equal(r.ok, true);
  assert.equal(r.compression, 'lz4-block');
});

test('rejects garbage and non-Rokoko JSON', () => {
  assert.equal(decodeDatagram(Buffer.from([1, 2, 3, 4, 5])).ok, false);
  assert.equal(decodeDatagram(Buffer.from('{"hello":1}')).ok, false);
});
