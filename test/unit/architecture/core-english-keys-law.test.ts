/**
 * Core English keeps every database key core reads.
 *
 * The build drops `tools.database.*` keys from the eager English chunk; the
 * Database tools bring them back through `blok.toolMessages`. A key that core
 * code reads without the Database tool must stay in core, or core shows the
 * raw key. scripts/english-parts.mjs lists them. This test walks the import
 * graph of every entry except the tool entries (`tools`, `full`) and rebuilds
 * that list from the string literals it finds.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CORE_DATABASE_KEYS,
  CORE_DATABASE_PREFIXES,
} from '../../../scripts/english-parts.mjs';

const REPO_ROOT = resolve(__dirname, '../../..');

/** Entries a consumer can load without the Database tool (vite.config.mjs + /locales). */
const CORE_ENTRIES = [
  'src/blok.ts',
  'src/markdown/index.ts',
  'src/view/index.ts',
  'src/migrate/index.ts',
  'src/adapters.ts',
  'src/icons/index.ts',
  'src/preprocess/index.ts',
  'src/agent-models/index.ts',
  'src/locales.ts',
];

const IMPORT_RE = /(import|export)(\s+type)?\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

const resolveSpecifier = (from: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) {
    return null;
  }
  const base = resolve(dirname(from), specifier.split('?')[0]);
  const candidates = [base, `${base}.ts`, `${base}/index.ts`];

  return candidates.find((file) => existsSync(file) && statSync(file).isFile() && file.endsWith('.ts')) ?? null;
};

/** Every runtime-imported .ts file reachable from the entries (type-only imports skipped). */
const coreFiles = (): string[] => {
  const seen = new Set<string>();
  const queue = CORE_ENTRIES.map((entry) => resolve(REPO_ROOT, entry));

  while (queue.length > 0) {
    const file = queue.pop();

    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);

    const targets = [...readFileSync(file, 'utf-8').matchAll(IMPORT_RE)]
      .filter((match) => match[2] === undefined)
      .map((match) => resolveSpecifier(file, match[3] ?? match[4] ?? match[5]));

    queue.push(...targets.filter((target): target is string => target !== null));
  }

  return [...seen];
};

describe('core English database keys', () => {
  const literals = new Map<string, string>();

  for (const file of coreFiles()) {
    for (const match of readFileSync(file, 'utf-8').matchAll(/tools\.database\.[\w.]*/g)) {
      literals.set(match[0], relative(REPO_ROOT, file));
    }
  }

  it('walks the core import graph', () => {
    expect(literals.size).toBeGreaterThan(10);
  });

  it('lists exactly the database keys and prefixes core code reads', () => {
    const found = [...literals.keys()].filter((key) => key !== 'tools.database.');

    expect({
      keys: found.filter((key) => !key.endsWith('.')).sort(),
      prefixes: found.filter((key) => key.endsWith('.')).sort(),
    }).toEqual({
      keys: [...CORE_DATABASE_KEYS].sort(),
      prefixes: [...CORE_DATABASE_PREFIXES].sort(),
    });
  });

  it('never builds a database key from the bare namespace in core', () => {
    // Such a key could be anything, so no list could keep it in core.
    expect(literals.has('tools.database.') ? literals.get('tools.database.') : null).toBeNull();
  });
});
