/**
 * The Hint tool is opt-in, so the playground must register it to try it.
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

describe('playground Hint tool', () => {
  it('imports the tool from the tools entry', () => {
    expect(INDEX_HTML).toMatch(/import \{[^}]*\bAnnotation\b[^}]*\} from '\.\/src\/tools\/index\.ts'/);
  });

  it('registers it as an inline tool under its name', () => {
    expect(buildConfigSource()).toMatch(/\bannotation:\s*Annotation\b/);
  });
});
