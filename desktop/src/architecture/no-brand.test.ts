import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

const SRC = join(process.cwd(), 'src');
// Assemble without a contiguous brand literal so `grep` over desktop/src stays clean.
const BRAND = new RegExp(
  [
    ['t', 'o', 'u', 's', 'a', 'm', 'b', 'a'].join(''),
    ['T', 'o', 'u', 's', 'a', 'm', 'b', 'a', 's', 's', 'a', 'd', 'e', 'u', 'r', 's'].join(''),
  ].join('|'),
  'i',
);

function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) return collect(path);
    if (!/\.(ts|tsx|js|mjs|css)$/.test(entry)) return [];
    return [path];
  });
}

describe('self-host product — no client brand under desktop/src', () => {
  it('contains zero client-brand occurrences', () => {
    const hits = collect(SRC).flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n');
      return lines.flatMap((line, index) => BRAND.test(line) ? [`${relative(SRC, file)}:${index + 1}: ${line.trim()}`] : []);
    });
    expect(hits).toEqual([]);
  });
});
