import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../');
const shell = resolve(repoRoot, 'src/components/modules/paste/index.ts');

/** Value imports and re-exports only: `import type` is erased and `import()` is a separate chunk. */
const STATIC_SPECIFIER = /(?:^|[;\n])\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

const resolveSource = (from: string, specifier: string): string | null => {
  const base = resolve(dirname(from), specifier);

  return [`${base}.ts`, resolve(base, 'index.ts'), base].find(path => path.endsWith('.ts') && existsSync(path)) ?? null;
};

const staticClosure = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();

    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);
    const next = [...readFileSync(file, 'utf-8').matchAll(STATIC_SPECIFIER)]
      .map(match => (match[1] === undefined ? null : resolveSource(file, match[1])))
      .filter((path): path is string => path !== null);

    queue.push(...next);
  }

  return seen;
};

/** The paste pipeline loads on the first paste, so the editor's boot code must not reach it. */
const PIPELINE = [
  'src/components/modules/paste/engine.ts',
  'src/components/modules/paste/handlers/',
  'src/components/modules/paste/preprocess-pasted-html.ts',
  'src/components/modules/paste/notion-blocks-v3.ts',
  'src/components/modules/paste/next-space-blocks.ts',
  'src/components/modules/paste/html-import.ts',
  'src/markdown/markdown-handler.ts',
  'src/shared/embed-registry.ts',
];

describe('paste engine boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the paste pipeline out of the Paste module static imports', () => {
    const reached = [...staticClosure(shell)].map(file => relative(repoRoot, file));

    expect(reached.filter(file => PIPELINE.some(part => file.startsWith(part)))).toEqual([]);
  });
});
