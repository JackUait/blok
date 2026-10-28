// A minimal ZIP writer for scripts and tests. Plain zip only: no zip64, no data
// descriptors, no comments. Every entry gets the DOS date 1980-01-01 00:00, so
// the same input always gives the same bytes.
import { deflateRawSync } from 'node:zlib';

const LIMIT_32 = 0xffffffff;
// 0xFFFF in the entry count field means "look in the zip64 record".
const LIMIT_ENTRIES = 0xffff;
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const VERSION = 20;
const MADE_BY_UNIX = (3 << 8) | VERSION;
const UTF8_NAME_FLAG = 0x800;

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value;
});

/**
 * @param {Uint8Array} data
 * @returns {number}
 */
function crc32(data) {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} what
 * @param {number} value
 */
function assertFits(what, value) {
  if (value >= LIMIT_32) {
    throw new Error(`createZip: ${what} needs zip64, which is not supported`);
  }
}

/**
 * @param {Array<{ name: string, data: Uint8Array | string, mode?: number }>} files
 * @returns {Buffer}
 */
export function createZip(files) {
  if (files.length >= LIMIT_ENTRIES) {
    throw new Error(`createZip: ${files.length} entries need zip64, which is not supported`);
  }

  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const data = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : file.data;

    assertFits(`${file.name} (${data.byteLength} bytes)`, data.byteLength);

    const name = Buffer.from(file.name, 'utf8');
    const flags = /^[\x00-\x7f]*$/.test(file.name) ? 0 : UTF8_NAME_FLAG;
    const body = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const unix = file.mode !== undefined;
    const attributes = unix ? file.mode * 0x10000 : 0;

    assertFits(`${file.name} (compressed)`, body.byteLength);
    assertFits('archive offset', offset);

    const local = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(unix ? MADE_BY_UNIX : VERSION, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(attributes, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, Buffer.from(body.buffer, body.byteOffset, body.byteLength));
    centrals.push(central, name);
    offset += local.length + name.length + body.byteLength;
  }

  const directory = Buffer.concat(centrals);

  assertFits('central directory offset', offset);
  assertFits('archive size', offset + directory.length + 22);

  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}
