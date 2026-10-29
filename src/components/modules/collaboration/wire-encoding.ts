// Writes lib0's wire format: LEB128 varuints and length-prefixed UTF-8.
// The bytes are pinned against lib0 by test/unit/server-conformance/lib0-parity.test.ts.

const utf8 = new TextEncoder();

export class Encoder {
  private bytes = new Uint8Array(256);
  private length = 0;

  /**
   * Seven bits per byte, low bits first; the high bit says another byte follows.
   * Division, not `>>>`: a shift is 32-bit and would cut values above 2^32.
   * @param num - a non-negative safe integer
   */
  public writeVarUint(num: number): void {
    if (num > 0x7f) {
      this.writeByte(0x80 | (num & 0x7f));
      this.writeVarUint(Math.floor(num / 128));

      return;
    }

    this.writeByte(num & 0x7f);
  }

  public writeVarUint8Array(bytes: Uint8Array): void {
    this.writeVarUint(bytes.byteLength);
    this.reserve(bytes.byteLength);
    this.bytes.set(bytes, this.length);
    this.length += bytes.byteLength;
  }

  /** A lone surrogate becomes U+FFFD, as TextEncoder (and so lib0) writes it. */
  public writeVarString(text: string): void {
    this.writeVarUint8Array(utf8.encode(text));
  }

  /** An owned copy the exact size of what was written. */
  public toUint8Array(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }

  private writeByte(byte: number): void {
    this.reserve(1);
    this.bytes[this.length] = byte;
    this.length += 1;
  }

  private reserve(extra: number): void {
    const needed = this.length + extra;

    if (needed <= this.bytes.length) {
      return;
    }

    const grown = new Uint8Array(Math.max(this.bytes.length * 2, needed));

    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }
}
