/**
 * The playground lets the embed block frame any site, so a pasted link
 * from a service outside the registry can be tried there.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

const buildConfigSource = (): string => {
  const start = INDEX_HTML.indexOf('    function buildConfig() {');

  if (start === -1) {
    throw new Error('index.html has no buildConfig()');
  }

  // The function closes at its own indent.
  const end = INDEX_HTML.indexOf('\n    }\n', start);

  return INDEX_HTML.slice(start, end);
};

describe('playground generic embeds', () => {
  it('turns on embeds for sites outside the registry', () => {
    expect(buildConfigSource()).toMatch(/linkPaste:\s*\{\s*allowGenericEmbed:\s*true\s*\}/);
  });
});
