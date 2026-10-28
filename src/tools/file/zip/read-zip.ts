import { inflateRaw } from './inflate';
import { ZipError } from './zip-error';

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

/**
 * Loose enough that real large spreadsheets still open: V8 cannot make a string from
 * a part much past 512 MiB, so no text part JSZip could read is refused. pptx-renderer
 * still applies its own stricter limits from `_data.uncompressedSize`.
 */
export const DEFAULT_ZIP_LIMITS: Readonly<ZipLimits> = Object.freeze({
  maxEntries: 65535,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
});

export interface ZipEntry {
  readonly name: string;
  readonly dir: boolean;
  /** Declared uncompressed size; 0 for a dir. */
  readonly size: number;
}

export interface ZipArchive {
  /** Archive order. A repeated name keeps its first place and its last entry. */
  readonly entries: readonly ZipEntry[];
  /** Any entry by its resolved name, dirs included (their names end in "/"). */
  get(name: string): ZipEntry | undefined;
  /** A fresh copy of the entry's bytes; inflate never goes past the declared size. */
  read(entry: ZipEntry): Uint8Array<ArrayBuffer>;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_END = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const MAX_16 = 0xffff;
const MAX_32 = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;
const MADE_BY_UNIX = 3;

/** Bounds-checked little-endian reads. `zero` shifts every index past bytes prepended to the archive. */
class Reader {
  private readonly view: DataView;

  constructor(public readonly bytes: Uint8Array, private readonly zero = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public shifted(zero: number): Reader {
    return new Reader(this.bytes, zero);
  }

  public u16(index: number): number {
    return this.view.getUint16(this.at(index, 2), true);
  }

  public u32(index: number): number {
    return this.view.getUint32(this.at(index, 4), true);
  }

  public u64(index: number): number {
    const value = this.u32(index + 4) * 0x100000000 + this.u32(index);

    if (!Number.isSafeInteger(value)) {
      throw new ZipError('Corrupted zip: 64-bit value too large');
    }

    return value;
  }

  public slice(index: number, length: number): Uint8Array {
    const start = this.at(index, length);

    return this.bytes.subarray(start, start + length);
  }

  /** Index (relative to zero) of the last occurrence of a signature, or -1. */
  public lastIndexOf(signature: number): number {
    // eslint-disable-next-line no-restricted-syntax -- backwards byte scan
    for (let i = this.bytes.length - 4; i >= 0; i--) {
      if (this.view.getUint32(i, true) === signature) {
        return i - this.zero;
      }
    }

    return -1;
  }

  private at(index: number, length: number): number {
    const start = this.zero + index;

    if (!Number.isSafeInteger(start) || index < 0 || length < 0 || start + length > this.bytes.length) {
      throw new ZipError('Corrupted zip: unexpected end of data');
    }

    return start;
  }
}

interface CentralRecord {
  madeBy: number;
  method: number;
  compressedSize: number;
  size: number;
  externalAttr: number;
  offset: number;
}

interface Stored {
  method: number;
  data: Uint8Array;
}

/** Drops "." and empty middle segments and lets ".." pop, so no name climbs above the archive root. */
const resolveName = (path: string): string => {
  const parts = path.split('/');
  const out: string[] = [];

  parts.forEach((part, index) => {
    if (part === '.' || (part === '' && index !== 0 && index !== parts.length - 1)) {
      return;
    }
    if (part === '..') {
      out.pop();
    } else {
      out.push(part);
    }
  });

  return out.join('/');
};

interface CentralDirectory {
  records: number;
  offset: number;
  /** Where the end-of-central-directory record would sit with nothing prepended. */
  expectedEnd: number;
}

function readZip64End(reader: Reader): CentralDirectory {
  const locator = reader.lastIndexOf(SIG_ZIP64_LOCATOR);

  if (locator < 0) {
    throw new ZipError('Corrupted zip: no ZIP64 end of central directory locator');
  }
  if (reader.u32(locator + 16) > 1) {
    throw new ZipError('Multi-volume zips are not supported');
  }
  const declared = reader.u64(locator + 8);
  const end64 = reader.u32(declared) === SIG_ZIP64_END ? declared : reader.lastIndexOf(SIG_ZIP64_END);

  if (end64 < 0) {
    throw new ZipError('Corrupted zip: no ZIP64 end of central directory');
  }
  const size = reader.u64(end64 + 40);
  const offset = reader.u64(end64 + 48);

  return { records: reader.u64(end64 + 32), offset, expectedEnd: offset + size + 20 + 12 + reader.u64(end64 + 4) };
}

/** Finds the central directory. Offsets skip any bytes prepended to the archive (self-extractors, signed packages). */
function readEnd(unshifted: Reader): { reader: Reader; records: number; offset: number } {
  const end = unshifted.lastIndexOf(SIG_END);

  if (end < 0) {
    const looksLikeZip = unshifted.bytes.length >= 4 && unshifted.u32(0) === SIG_LOCAL;

    throw new ZipError(looksLikeZip ? 'Corrupted zip: no end of central directory' : 'Not a zip file');
  }
  const size = unshifted.u32(end + 12);
  const offset = unshifted.u32(end + 16);

  // A cut-off archive comment means a truncated file.
  unshifted.slice(end + 22, unshifted.u16(end + 20));
  const isZip64 = [4, 6, 8, 10].some((at) => unshifted.u16(end + at) === MAX_16) || size === MAX_32 || offset === MAX_32;
  const directory = isZip64
    ? readZip64End(unshifted)
    : { records: unshifted.u16(end + 10), offset, expectedEnd: offset + size };
  const extraBytes = end - directory.expectedEnd;

  if (extraBytes < 0) {
    throw new ZipError(`Corrupted zip: missing ${-extraBytes} bytes`);
  }

  return { reader: unshifted.shifted(extraBytes), records: directory.records, offset: directory.offset };
}

/** The value bytes of the ZIP64 extra field (id 0x0001); if repeated, the last one wins. */
function findZip64Field(reader: Reader, start: number, end: number): Uint8Array | undefined {
  /* eslint-disable no-restricted-syntax -- walks variable-length fields */
  let found: Uint8Array | undefined;

  // Android tools leave up to 4 bytes of padding at the end; it is skipped, not read as a field.
  for (let at = start; at + 4 < end;) {
    const value = reader.slice(at + 4, reader.u16(at + 2));

    found = reader.u16(at) === 0x0001 ? value : found;
    at += 4 + value.length;
  }
  /* eslint-enable no-restricted-syntax */

  return found;
}

/** Swaps 0xFFFFFFFF sizes and offset for the 64-bit values, which come in this order. */
function applyZip64(record: CentralRecord, field: Uint8Array): CentralRecord {
  const keys = (['size', 'compressedSize', 'offset'] as const).filter((key) => record[key] === MAX_32);
  const values = new Reader(field);

  return keys.reduce((next, key, i) => ({ ...next, [key]: values.u64(i * 8) }), record);
}

function readCentralRecord(reader: Reader, index: number): CentralRecord {
  if ((reader.u16(index + 8) & 1) !== 0) {
    throw new ZipError('Encrypted zips are not supported');
  }
  const extraStart = index + 46 + reader.u16(index + 28);
  const extraEnd = extraStart + reader.u16(index + 30);
  const record: CentralRecord = {
    madeBy: reader.u16(index + 4) >> 8,
    method: reader.u16(index + 10),
    compressedSize: reader.u32(index + 20),
    size: reader.u32(index + 24),
    externalAttr: reader.u32(index + 38),
    offset: reader.u32(index + 42),
  };
  const zip64 = findZip64Field(reader, extraStart, extraEnd);

  return zip64 === undefined ? record : applyZip64(record, zip64);
}

/** The central records, with every limit checked from the declared sizes before anything is inflated. */
function readCentral(reader: Reader, start: number, records: number, limits: ZipLimits): CentralRecord[] {
  const found: CentralRecord[] = [];

  /* eslint-disable no-restricted-syntax -- walks variable-length records */
  let index = start;
  let total = 0;

  // Each record is at least 46 bytes, so the buffer bounds this loop.
  while (reader.u32(index) === SIG_CENTRAL) {
    if (found.length >= limits.maxEntries) {
      throw new ZipError(`Zip has more than ${limits.maxEntries} entries`);
    }
    const record = readCentralRecord(reader, index);
    const recordEnd = index + 46 + reader.u16(index + 28) + reader.u16(index + 30) + reader.u16(index + 32);

    reader.slice(index, recordEnd - index);
    total += record.size;
    if (record.size > limits.maxEntryBytes) {
      throw new ZipError(`Zip entry of ${record.size} bytes is over the ${limits.maxEntryBytes} byte limit`);
    }
    if (total > limits.maxTotalBytes) {
      throw new ZipError(`Zip content is over the ${limits.maxTotalBytes} byte limit`);
    }
    found.push(record);
    index = recordEnd;
  }
  /* eslint-enable no-restricted-syntax */
  if (records !== 0 && found.length === 0) {
    throw new ZipError(`Corrupted zip: expected ${records} records, found none`);
  }

  return found;
}

export function readZip(data: ArrayBuffer | Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipArchive {
  const { reader, records, offset } = readEnd(new Reader(data instanceof Uint8Array ? data : new Uint8Array(data)));
  const byName = new Map<string, ZipEntry>();
  const contents = new Map<ZipEntry, Stored>();
  const located = readCentral(reader, offset, records, limits).map((record) => {
    if (reader.u32(record.offset) !== SIG_LOCAL) {
      throw new ZipError('Corrupted zip: bad local header');
    }
    const nameLength = reader.u16(record.offset + 26);
    const dataStart = record.offset + 30 + nameLength + reader.u16(record.offset + 28);

    return { record, nameLength, end: dataStart + record.compressedSize, compressed: reader.slice(dataStart, record.compressedSize) };
  });

  // Overlapping entries (one region read by many records) make a CPU bomb; real zips never overlap.
  // Checked before any name is decoded, so name work stays bounded by the file size.
  const regions = located.map(({ record, end }) => ({ start: record.offset, end })).sort((a, b) => a.start - b.start);

  regions.forEach((region, i) => {
    const next = regions[i + 1];

    if (next !== undefined && region.end > next.start) {
      throw new ZipError('Corrupted zip: entries overlap');
    }
  });

  located.forEach(({ record, nameLength, compressed }) => {
    // The local name wins: some Windows tools write backslashes only in the central one.
    const rawName = utf8.decode(reader.slice(record.offset + 30, nameLength));

    if (record.method !== STORED && record.method !== DEFLATED) {
      throw new ZipError(`Corrupted zip: unknown compression method ${record.method}`);
    }
    const unixDir = record.madeBy === MADE_BY_UNIX && ((record.externalAttr >>> 16) & 0x4000) !== 0;
    const dir = (record.externalAttr & 0x10) !== 0 || unixDir || rawName.endsWith('/');
    const resolved = resolveName(rawName);
    const name = dir && !resolved.endsWith('/') ? `${resolved}/` : resolved;
    const size = dir ? 0 : record.size;

    if (record.method === STORED && size !== 0 && record.compressedSize !== size) {
      throw new ZipError('Corrupted zip: stored entry sizes differ');
    }
    const entry: ZipEntry = Object.freeze({ name, dir, size });
    const previous = byName.get(name);

    if (previous !== undefined) {
      contents.delete(previous);
    }
    byName.set(name, entry);
    contents.set(entry, { method: record.method, data: compressed });
  });

  return {
    entries: Object.freeze(Array.from(byName.values())),
    get: (name) => byName.get(name),
    read: (entry) => {
      const stored = contents.get(entry);

      if (stored === undefined) {
        throw new ZipError('Entry is not from this archive');
      }
      // Dirs and empty entries may carry junk data; it is never inflated.
      if (entry.size === 0) {
        return new Uint8Array(0);
      }
      if (stored.method === STORED) {
        return stored.data.slice();
      }
      return inflateRaw(stored.data, entry.size);
    },
  };
}
