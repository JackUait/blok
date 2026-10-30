// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A consumer that registers only media tools must not ship the database agent code.
 * The bundler keeps every module a tool reaches through static value imports, so one
 * stray import here puts ~28 KB gz of database code into every Image/File/... consumer.
 */
const projectRoot = resolve(__dirname, '../../..');
const src = join(projectRoot, 'src');

// The lib entries vite.config.mjs builds for these tools (tool-entries/tool-*).
const mediaEntries = ['image', 'file', 'audio', 'video', 'link/embed', 'link/bookmark']
  .map(tool => join(src, 'tools', tool, 'index.ts'));

const forbidden = (file: string): boolean => {
  const path = relative(src, file);

  return path === 'shared/tool-actions/database.ts'
    || path === 'shared/agent/approval.ts'
    || path.startsWith('shared/database/');
};

const resolveImport = (from: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/types/')) {
    return undefined;
  }
  const base = specifier.startsWith('.')
    ? resolve(dirname(from), specifier)
    : join(projectRoot, 'types', specifier.slice('@/types/'.length));

  return [base, `${base}.ts`, join(base, 'index.ts')].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
};

// `import type` and `export type` are erased; dynamic import() becomes a lazy chunk.
const staticValueImport = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

/** Every module reached by static value imports, mapped to the module that first imported it. */
const reach = (entry: string): Map<string, string | undefined> => {
  const parents = new Map<string, string | undefined>([[entry, undefined]]);
  const queue = [entry];

  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const importer = file;
    const targets = [...readFileSync(importer, 'utf8').matchAll(staticValueImport)]
      .map(match => (match[1] === undefined ? undefined : resolveImport(importer, match[1])))
      .filter((target): target is string => target !== undefined && target.endsWith('.ts') && !parents.has(target));

    targets.forEach(target => {
      parents.set(target, importer);
      queue.push(target);
    });
  }

  return parents;
};

const chain = (parents: Map<string, string | undefined>, file: string): string => {
  const steps: string[] = [];

  for (let current: string | undefined = file; current !== undefined; current = parents.get(current)) {
    steps.unshift(relative(src, current));
  }

  return steps.join(' -> ');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('media tools database law', () => {
  it.each(mediaEntries.map(entry => ({ tool: relative(join(src, 'tools'), dirname(entry)), entry })))(
    '$tool reaches no database agent module through static imports',
    ({ entry }) => {
      const parents = reach(entry);
      const leaks = [...parents.keys()].filter(forbidden).map(file => chain(parents, file));

      expect(leaks).toEqual([]);
      // Proves the walk follows the real upload path, so an empty list is not a resolver miss.
      expect([...parents.keys()].map(file => relative(src, file))).toEqual(
        expect.arrayContaining(['shared/tool-actions/upload.ts', 'shared/mime-match.ts'])
      );
    }
  );
});
