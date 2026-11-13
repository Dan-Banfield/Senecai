// Decodes one Rokoko Studio live-stream UDP datagram into a JSON v3 frame.
//
// Studio can send plain UTF-8 JSON or LZ4-compressed JSON. The Blender plugin
// uses LZ4 *frame* format, while the Unity plugin uses a native LZ4 call we
// couldn't inspect (possibly raw block format). We try all three, cheapest
// first, so whatever Studio sends on the day should just work.
import lz4 from 'lz4js';

const LZ4_FRAME_MAGIC = [0x04, 0x22, 0x4d, 0x18];
const MAX_DECOMPRESSED = 4 * 1024 * 1024;

function isLz4Frame(buf) {
  return buf.length >= 4 && LZ4_FRAME_MAGIC.every((b, i) => buf[i] === b);
}

function tryJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return undefined;
  }
}

function tryLz4Block(buf, offset) {
  try {
    const out = new Uint8Array(MAX_DECOMPRESSED);
    const n = lz4.decompressBlock(buf, out, offset, buf.length - offset, 0);
    if (n <= 0) return undefined;
    return tryJson(out.subarray(0, n));
  } catch {
    return undefined;
  }
}

/**
 * @param {Buffer} buf
 * @returns {{ok: true, frame: any, text: string, compression: string} | {ok: false, error: string}}
 */
export function decodeDatagram(buf) {
  let frame;
  let compression = 'none';

  if (isLz4Frame(buf)) {
    try {
      frame = tryJson(lz4.decompress(buf, MAX_DECOMPRESSED));
      compression = 'lz4-frame';
    } catch (e) {
      return { ok: false, error: `LZ4 frame decompression failed: ${e.message}` };
    }
  } else {
    frame = tryJson(buf);
    if (frame === undefined) {
      // Raw LZ4 block, with or without a 4-byte uncompressed-size prefix.
      frame = tryLz4Block(buf, 0) ?? tryLz4Block(buf, 4);
      compression = 'lz4-block';
    }
  }

  if (frame === undefined) {
    return { ok: false, error: 'Datagram is neither JSON nor LZ4-compressed JSON. In Studio, set the custom stream data format to JSON v3.' };
  }
  if (!frame.scene || !Array.isArray(frame.scene.actors)) {
    return { ok: false, error: 'JSON received, but it is not a Rokoko v3 frame (missing scene.actors).' };
  }
  return { ok: true, frame, text: JSON.stringify(frame), compression };
}
