import { deflateRawSync } from 'node:zlib';

/** One entry of a hand-built test archive. Every override writes a value a real zip tool would not. */
export interface BuildEntry {
  name: string | Uint8Array;
  data?: Uint8Array;
  /** 0 = stored, 8 = deflate; anything else is written as-is. */
  method?: number;
  compressed?: Uint8Array;
  size?: number;
  compressedSize?: number;
  flags?: number;
  centralExtra?: Uint8Array;
  localExtra?: Uint8Array;
  externalAttr?: number;
  versionMadeBy?: number;
  localName?: string | Uint8Array;
  localOffset?: number;
}

export interface BuildOptions {
  prepend?: Uint8Array;
  append?: Uint8Array;
  /** Writes ZIP64 end records; fields left out take their real values. */
  zip64?: { cdOffset?: bigint; cdSize?: bigint; records?: bigint };
  /** With zip64: the end record keeps real values instead of 0xFFFF markers, as `zip` writes when reading stdin. */
  plainEnd?: boolean;
  /** Record count written in the end record. */
  endRecords?: number;
  comment?: Uint8Array;
}

const bytesOf = (value: string | Uint8Array): Uint8Array =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value;

class Writer {
  private readonly parts: Uint8Array[] = [];
  public length = 0;

  public bytes(value: Uint8Array): void {
    this.parts.push(value);
    this.length += value.length;
  }

  public u16(value: number): void {
    const b = new Uint8Array(2);

    new DataView(b.buffer).setUint16(0, value, true);
    this.bytes(b);
  }

  public u32(value: number): void {
    const b = new Uint8Array(4);

    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    this.bytes(b);
  }

  public u64(value: bigint): void {
    const b = new Uint8Array(8);

    new DataView(b.buffer).setBigUint64(0, value, true);
    this.bytes(b);
  }

  public join(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let at = 0;

    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }

    return out;
  }
}

/** A ZIP64 extended-information extra field (id 0x0001) holding the given 64-bit values in order. */
export function zip64Extra(...values: bigint[]): Uint8Array {
  const w = new Writer();

  w.u16(0x0001);
  w.u16(values.length * 8);
  values.forEach((v) => w.u64(v));

  return w.join();
}

export function buildZip(entries: BuildEntry[], options: BuildOptions = {}): Uint8Array<ArrayBuffer> {
  const body = new Writer();
  const central = new Writer();

  for (const entry of entries) {
    const data = entry.data ?? new Uint8Array(0);
    const method = entry.method ?? 0;
    const compressed = entry.compressed ?? (method === 8 ? new Uint8Array(deflateRawSync(data)) : data);
    const name = bytesOf(entry.name);
    const localName = bytesOf(entry.localName ?? entry.name);
    const localExtra = entry.localExtra ?? new Uint8Array(0);
    const centralExtra = entry.centralExtra ?? new Uint8Array(0);
    const offset = body.length;
    const header = (w: Writer): void => {
      w.u16(entry.flags ?? 0);
      w.u16(method);
      w.u32(0);
      w.u32(0);
      w.u32(entry.compressedSize ?? compressed.length);
      w.u32(entry.size ?? data.length);
    };

    body.u32(0x04034b50);
    body.u16(20);
    header(body);
    body.u16(localName.length);
    body.u16(localExtra.length);
    body.bytes(localName);
    body.bytes(localExtra);
    body.bytes(compressed);

    central.u32(0x02014b50);
    central.u16(entry.versionMadeBy ?? 20);
    central.u16(20);
    header(central);
    central.u16(name.length);
    central.u16(centralExtra.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(entry.externalAttr ?? 0);
    central.u32(entry.localOffset ?? offset);
    central.bytes(name);
    central.bytes(centralExtra);
  }

  const out = new Writer();
  const cdOffset = body.length;

  if (options.prepend) {
    out.bytes(options.prepend);
  }
  out.bytes(body.join());
  out.bytes(central.join());

  const zip64 = options.zip64;

  if (zip64) {
    const eocd64At = cdOffset + central.length;

    out.u32(0x06064b50);
    out.u64(BigInt(44));
    out.u16(45);
    out.u16(45);
    out.u32(0);
    out.u32(0);
    out.u64(zip64.records ?? BigInt(entries.length));
    out.u64(zip64.records ?? BigInt(entries.length));
    out.u64(zip64.cdSize ?? BigInt(central.length));
    out.u64(zip64.cdOffset ?? BigInt(cdOffset));
    out.u32(0x07064b50);
    out.u32(0);
    out.u64(BigInt(eocd64At));
    out.u32(1);
  }

  const marked = zip64 !== undefined && options.plainEnd !== true;
  const comment = options.comment ?? new Uint8Array(0);

  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(options.endRecords ?? (marked ? 0xffff : entries.length));
  out.u16(options.endRecords ?? (marked ? 0xffff : entries.length));
  out.u32(marked ? 0xffffffff : central.length);
  out.u32(marked ? 0xffffffff : cdOffset);
  out.u16(comment.length);
  out.bytes(comment);

  if (options.append) {
    out.bytes(options.append);
  }

  return out.join();
}
