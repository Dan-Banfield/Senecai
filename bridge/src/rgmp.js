// RGMP v2 (Rokoko General Motion Protocol) stream parser.
//
// Spec: https://sdk.rokoko.com/reference/rgmp/ (summarised):
//   - TCP, little-endian, no subscribe message: the server pushes frames.
//   - Outer frame: uint32 msg_prefix (1 = definition, 2 = data, 3 = disconnect), uint32 msg_len, payload.
//   - Definition: UTF-8 JSON describing the device, its groups and their streams.
//   - Data: uint32 device_id, uint32 group_id, uint64 timestamp_us, then the group's
//     stream values tightly packed in definition order (each sized by its data_type).
//   - Disconnect: uint32 device_id.
//   - Unknown frame types must be ignored.
//
// Offsets are computed from the definition rather than hardcoded, so the parser
// keeps working if Rokoko adds or reorders streams.

export const MSG_DEFINITION = 1;
export const MSG_DATA = 2;
export const MSG_DISCONNECT = 3;

const SCALAR = {
  INT32: { size: 4, read: (b, o) => b.readInt32LE(o) },
  UINT32: { size: 4, read: (b, o) => b.readUInt32LE(o) },
  INT64: { size: 8, read: (b, o) => Number(b.readBigInt64LE(o)) },
  UINT64: { size: 8, read: (b, o) => Number(b.readBigUInt64LE(o)) },
  FLOAT: { size: 4, read: (b, o) => b.readFloatLE(o) },
  DOUBLE: { size: 8, read: (b, o) => b.readDoubleLE(o) },
};

/** "FLOAT[7]" -> { scalar, count: 7 }, "DOUBLE[3,3]" -> count 9, "UINT32" -> count 1. */
export function parseDataType(dataType) {
  const m = /^([A-Z0-9]+)(?:\[(\d+)(?:\s*,\s*(\d+))?\])?$/.exec(String(dataType).trim().toUpperCase());
  if (!m || !SCALAR[m[1]]) throw new Error(`unknown RGMP data_type "${dataType}"`);
  const count = (m[2] ? Number(m[2]) : 1) * (m[3] ? Number(m[3]) : 1);
  return { scalar: SCALAR[m[1]], count, size: SCALAR[m[1]].size * count };
}

/** Precompute per-group stream offsets from a definition frame. */
export function compileDefinition(def) {
  const groups = new Map();
  (def.groups ?? []).forEach((g, index) => {
    const id = g.group_id ?? g.id ?? index;
    let offset = 16; // data header
    const streams = (g.streams ?? []).map((s) => {
      const t = parseDataType(s.data_type);
      const compiled = { ...s, offset, count: t.count, scalar: t.scalar };
      offset += t.size;
      return compiled;
    });
    groups.set(id, { name: g.name, streams, size: offset });
  });
  return { def, groups };
}

export function decodeData(payload, compiled) {
  const deviceId = payload.readUInt32LE(0);
  const groupId = payload.readUInt32LE(4);
  const timestampUs = Number(payload.readBigUInt64LE(8));
  const group = compiled?.groups.get(groupId);
  if (!group) return { deviceId, groupId, timestampUs, group: null, values: [] };
  if (payload.length < group.size) throw new Error(`RGMP data frame too short for group "${group.name}": ${payload.length} < ${group.size} bytes`);
  const values = group.streams.map((s) => {
    const v = new Array(s.count);
    for (let i = 0; i < s.count; i++) v[i] = s.scalar.read(payload, s.offset + i * s.scalar.size);
    return v;
  });
  return { deviceId, groupId, timestampUs, group, values };
}

/**
 * Incremental parser for a TCP byte stream. Feed it chunks; it calls
 * onDefinition(deviceId, compiled), onData(decoded, compiled) and onDisconnect(deviceId).
 */
export class RgmpParser {
  constructor({ onDefinition, onData, onDisconnect, onError } = {}) {
    this.buf = Buffer.alloc(0);
    this.devices = new Map(); // device_id -> compiled definition
    this.handlers = { onDefinition, onData, onDisconnect, onError };
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 8) {
      const type = this.buf.readUInt32LE(0);
      const len = this.buf.readUInt32LE(4);
      if (len > 64 * 1024 * 1024) {
        this.handlers.onError?.(new Error(`implausible RGMP frame length ${len}; is this really an RGMP port?`));
        this.buf = Buffer.alloc(0);
        return;
      }
      if (this.buf.length < 8 + len) return;
      const payload = this.buf.subarray(8, 8 + len);
      this.buf = this.buf.subarray(8 + len);
      try {
        this.handleFrame(type, payload);
      } catch (e) {
        this.handlers.onError?.(e);
      }
    }
  }

  handleFrame(type, payload) {
    if (type === MSG_DEFINITION) {
      const def = JSON.parse(payload.toString('utf8'));
      const compiled = compileDefinition(def);
      this.devices.set(def.device_id, compiled);
      this.handlers.onDefinition?.(def.device_id, compiled);
    } else if (type === MSG_DATA) {
      const deviceId = payload.readUInt32LE(0);
      const compiled = this.devices.get(deviceId);
      if (!compiled) return; // data before its definition: skip
      this.handlers.onData?.(decodeData(payload, compiled), compiled);
    } else if (type === MSG_DISCONNECT) {
      const deviceId = payload.readUInt32LE(0);
      this.devices.delete(deviceId);
      this.handlers.onDisconnect?.(deviceId);
    }
    // Other types: ignore (spec extensibility rule).
  }
}

/** Encode helpers (used by the fake SDK server and tests). */
export function encodeFrame(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(type, 0);
  head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, payload]);
}
