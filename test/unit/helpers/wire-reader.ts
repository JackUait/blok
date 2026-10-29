// Test-only reader for frames built by wire-encoding. Strict: a truncated
// value throws instead of reading past the end.

const utf8 = new TextDecoder();

export class WireReader {
  public constructor(private readonly arr: Uint8Array, private pos = 0) {}

  public hasContent(): boolean {
    return this.pos !== this.arr.length;
  }

  public readVarUint(): number {
    return this.readVarUintFrom(0, 1);
  }

  public readVarUint8Array(): Uint8Array {
    const length = this.readVarUint();

    if (length > this.arr.length - this.pos) {
      throw new RangeError('wire-reader: byte run past the end');
    }

    const bytes = this.arr.subarray(this.pos, this.pos + length);

    this.pos += length;

    return bytes;
  }

  public readVarString(): string {
    return utf8.decode(this.readVarUint8Array());
  }

  private readVarUintFrom(total: number, scale: number): number {
    if (this.pos >= this.arr.length) {
      throw new RangeError('wire-reader: varuint runs past the end');
    }

    const byte = this.arr[this.pos];

    this.pos += 1;

    const value = total + (byte & 0x7f) * scale;

    return byte < 0x80 ? value : this.readVarUintFrom(value, scale * 128);
  }
}
