// JSZip's own UTF-8 decoder (lib/utf8.js, from pako), ported so text and names
// match the browser build byte for byte. It differs from TextDecoder on invalid
// input (lone continuation bytes, overlongs, surrogates) and keeps a BOM.

const CHUNK = 16 * 1024;

/** Sequence length by lead byte. JSZip marks only 254 as one byte; 255 stays six (its typo, kept). */
const LENGTHS = Uint8Array.from({ length: 256 }, (_, lead) => {
  if (lead === 254) {
    return 1;
  }
  const bounds = [252, 248, 240, 224, 192];
  const at = bounds.findIndex((bound) => lead >= bound);

  return at < 0 ? 1 : 6 - at;
});

const sequenceLength = (lead: number): number => LENGTHS[lead] ?? 1;

const FIRST_BYTE_MASK: Record<number, number> = { 2: 0x1f, 3: 0x0f };

/* eslint-disable no-restricted-syntax -- byte scanners: the index and the code point advance inside the loops */
export function decodeUtf8(buf: Uint8Array): string {
  const units: number[] = [];
  let i = 0;

  while (i < buf.length) {
    let c = buf[i++] ?? 0;

    if (c < 0x80) {
      units.push(c);
      continue;
    }
    let len = sequenceLength(c);

    if (len > 4) {
      units.push(0xfffd);
      i += len - 1;
      continue;
    }
    c &= FIRST_BYTE_MASK[len] ?? 0x07;
    while (len > 1 && i < buf.length) {
      c = (c << 6) | ((buf[i++] ?? 0) & 0x3f);
      len--;
    }
    if (len > 1) {
      units.push(0xfffd);
      continue;
    }
    if (c < 0x10000) {
      units.push(c);
    } else {
      c -= 0x10000;
      units.push(0xd800 | ((c >> 10) & 0x3ff), 0xdc00 | (c & 0x3ff));
    }
  }

  let out = '';

  // fromCharCode.apply has an argument-count limit, so go in slices.
  for (let at = 0; at < units.length; at += CHUNK) {
    out += String.fromCharCode.apply(null, units.slice(at, at + CHUNK));
  }

  return out;
}

/** Where a chunk can end without splitting a sequence (JSZip's utf8border). */
const border = (buf: Uint8Array): number => {
  let pos = buf.length - 1;

  while (pos >= 0 && ((buf[pos] ?? 0) & 0xc0) === 0x80) {
    pos--;
  }
  if (pos <= 0) {
    return buf.length;
  }

  return pos + sequenceLength(buf[pos] ?? 0) > buf.length ? pos : buf.length;
};

/**
 * Decodes file content the way JSZip's Utf8DecodeWorker does: 16 KiB chunks, each
 * cut back to a sequence border. On invalid input this differs from one decode.
 */
export function decodeUtf8Text(bytes: Uint8Array): string {
  let out = '';
  let left: Uint8Array = new Uint8Array(0);

  for (let at = 0; at < bytes.length; at += CHUNK) {
    const piece = bytes.subarray(at, at + CHUNK);
    const data = left.length === 0 ? piece : new Uint8Array(left.length + piece.length);

    if (data !== piece) {
      data.set(left);
      data.set(piece, left.length);
    }
    const end = border(data);

    out += decodeUtf8(data.subarray(0, end));
    left = data.subarray(end);
  }

  return left.length > 0 ? out + decodeUtf8(left) : out;
}
/* eslint-enable no-restricted-syntax */
