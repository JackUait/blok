import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** What JSZip read from one archive, in the shape of fixtures/golden/jszip-archives.json. */
export type ArchiveSnapshot =
  | { error: true }
  | {
    entries: Array<{ name: string; dir: boolean; size: number | null; sha256: string; text: string }>;
    fileNull: string[];
  };

export const ROOT = resolve(__dirname, '../../../../..');

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const textSha256 = (text: string): string => sha256(Buffer.from(text, 'utf16le'));

/** Text is compared only for valid UTF-8: on invalid bytes JSZip emitted NULs and lone surrogates, TextDecoder emits U+FFFD. */
export const isUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    return true;
  } catch {
    return false;
  }
};

export const readGolden = (): Record<string, ArchiveSnapshot & { stage?: string }> =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/golden/jszip-archives.json'), 'utf8')) as Record<string, ArchiveSnapshot>;

/**
 * What readZip should match: the JSZip snapshot without its stage note (JSZip fails
 * some archives at read time that the reader refuses at load), and with the one
 * known gap applied: the reader ignores the WinRAR Unicode Path extra field (0x7075).
 */
export const expectedFor = (rel: string, snapshot: ArchiveSnapshot & { stage?: string }): ArchiveSnapshot => {
  if ('error' in snapshot) {
    return { error: true };
  }
  if (rel.endsWith('/local_encoding_in_name.zip')) {
    // CP866 names without the UTF-8 flag: JSZip's decoder made control characters, TextDecoder makes U+FFFD.
    const names = [
      '\ufffd\ufffd\ufffd\ufffd\ufffd \ufffd\ufffd\ufffd\ufffd\ufffd/',
      '\ufffd\ufffd\ufffd\ufffd\ufffd \ufffd\ufffd\ufffd\ufffd\ufffd/\ufffd\ufffd\ufffd\ufffd \u296a\ufffd\u2ba2\ufffd \ufffd\ufffd\ufffd\u3b25\ufffd\ufffd.txt',
    ];

    return {
      entries: snapshot.entries.map((e, i) => ({ ...e, name: names[i] ?? e.name })),
      fileNull: [names[0] ?? ''],
    };
  }
  if (rel.endsWith('/winrar_utf8_in_name.zip')) {
    return { ...snapshot, entries: snapshot.entries.map((e) => ({ ...e, name: e.name.replace('€', '_') })) };
  }

  return snapshot;
};
