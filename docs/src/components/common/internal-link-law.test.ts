import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every internal link must go through `components/common/Link`.
 *
 * The wrapper maps the address into the reader's locale tree AND emits the
 * trailing-slash form GitHub Pages serves directly. A component that imports
 * react-router's `Link` gets neither, so it renders a href that 301-redirects —
 * which is how one page's only cross-tree link stayed slashless while the other
 * ~11,000 were fixed at the wrapper.
 *
 * The two language switches are the sole exception: they build a fully-qualified
 * address for the OTHER tree, and re-prefixing it would produce `/ru/ru/…`.
 */
const SRC = resolve(process.cwd(), 'src');

/** The only files allowed to reach for react-router's Link, each with its reason. */
const EXEMPT: Record<string, string> = {
  'components/common/Link.tsx': 'is the wrapper — it has to wrap something',
  'components/common/LanguageSelector.tsx':
    'crosses locale trees on purpose; useLocalePath already serves the slash',
  'components/layout/Footer.tsx': 'the other language switch, same reason',
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

describe('internal link law', () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => {
      const source = readFileSync(file, 'utf8');
      // The import list, not a type-only or unrelated react-router import.
      return /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*'react-router'/.test(source);
    })
    .map((file) => relative(SRC, file))
    .filter((file) => EXEMPT[file] === undefined)
    .sort();

  it('routes every internal link through the locale-aware wrapper', () => {
    expect(
      offenders,
      'these import react-router\'s Link directly, so their hrefs skip both the locale ' +
        'prefix and the trailing slash: import { Link } from "components/common/Link" instead',
    ).toEqual([]);
  });

  // Guards against a glob that silently matches nothing.
  it('scans a real tree of components', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
  });
});
