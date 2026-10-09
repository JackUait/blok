// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const src = resolve(__dirname, '../../../src');
const root = join(src, 'shared/agent');
const forbiddenDirectories = ['components', 'tools', 'view'].map(directory => join(src, directory));
const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(name => name.endsWith('.ts'))
  .sort()
  .map(name => ({ name, text: readFileSync(join(root, name), 'utf8') }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent purity law', () => {
  it('includes the planner and at least the planned shared modules', () => {
    expect(files.map(file => file.name)).toContain('planner.ts');
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)('$name imports no DOM-bound editor, tool, view or parse5 module', ({ name, text }) => {
    const forbidden = [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)]
      .map(match => match[1])
      .filter(specifier => {
        if (specifier === undefined) {
          return false;
        }
        const target = resolve(dirname(join(root, name)), specifier);

        return /^parse5(?:\/|$)/.test(specifier)
          || forbiddenDirectories.some(directory => target === directory || target.startsWith(`${directory}${sep}`));
      });

    expect(forbidden).toEqual([]);
  });

  // This checks member-access spellings, not scoped global identifier references.
  it.each(files)('$name has no browser-global member-access spelling', ({ text }) => {
    expect(text).not.toMatch(/\b(?:window|document|navigator|localStorage)\s*(?:\.|\[)/);
  });
});
