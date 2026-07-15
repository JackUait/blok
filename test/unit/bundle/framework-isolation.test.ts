import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * Framework-weight isolation guard.
 *
 * Each framework adapter ships from its own package entry (`@bloklabs/core`,
 * `/react`, `/vue`, `/angular`, `/tools`, `/full`, `/markdown`). A consumer who
 * imports one entry must never pull in another framework's code. We prove this
 * at the source level by walking each entry's static + dynamic import graph and
 * asserting it never crosses into a sibling framework's directory and never
 * imports a foreign framework runtime.
 *
 * Source-level is the right altitude: React/Vue/Angular adapter code is inert
 * without importing its runtime, so a source graph that never reaches another
 * adapter dir (and never imports a foreign runtime) cannot produce a bundle that
 * carries that framework's weight. This runs without a build, so it catches
 * regressions the moment they're written.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..');
const SRC = path.join(REPO, 'src');

const FRAMEWORK_DIRS = {
  react: path.join(REPO, 'packages', 'react', 'src'),
  vue: path.join(REPO, 'packages', 'vue', 'src'),
  angular: path.join(REPO, 'packages', 'angular', 'src'),
} as const;

type Framework = keyof typeof FRAMEWORK_DIRS;

const RUNTIME_MATCHERS: Record<Framework, (spec: string) => boolean> = {
  react: (s) => s === 'react' || s.startsWith('react/') || s === 'react-dom' || s.startsWith('react-dom/'),
  vue: (s) => s === 'vue' || s.startsWith('vue/'),
  angular: (s) => s === '@angular/core' || s.startsWith('@angular/'),
};

/** Extract every static-import, re-export, and dynamic-import specifier. */
function extractSpecifiers(code: string): string[] {
  const out = new Set<string>();
  const staticRe = /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g;
  const sideEffectRe = /import\s*['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticRe, sideEffectRe, dynamicRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      out.add(m[1]);
    }
  }
  return [...out];
}

/** Resolve a relative specifier to a concrete source file, or null. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    base,
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) {
      return c;
    }
  }
  return null;
}

interface Graph {
  /** Files reached under src/. */
  srcFiles: Set<string>;
  /** Bare (non-relative) import specifiers reached. */
  bareImports: Set<string>;
}

/** Split one file's imports into in-src dependencies and bare specifiers. */
function fileDeps(file: string): { srcDeps: string[]; bare: string[] } {
  let code: string;
  try {
    code = readFileSync(file, 'utf8');
  } catch {
    return { srcDeps: [], bare: [] };
  }
  const srcDeps: string[] = [];
  const bare: string[] = [];
  for (const spec of extractSpecifiers(code)) {
    if (!spec.startsWith('.')) {
      bare.push(spec);
      continue;
    }
    // Only recurse into real source files under src/. Type-only `../types` /
    // `@/types` and the external core resolve outside src/ and are skipped.
    const resolved = resolveRelative(file, spec);
    if (resolved !== null && resolved.startsWith(SRC + path.sep)) {
      srcDeps.push(resolved);
    }
  }
  return { srcDeps, bare };
}

/** Walk the static + dynamic import graph from an entry, staying inside src/. */
function collectGraph(entry: string): Graph {
  const srcFiles = new Set<string>();
  const bareImports = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (srcFiles.has(file)) {
      continue;
    }
    srcFiles.add(file);
    const { srcDeps, bare } = fileDeps(file);
    srcDeps.forEach((dep) => stack.push(dep));
    bare.forEach((spec) => bareImports.add(spec));
  }
  return { srcFiles, bareImports };
}

/** Which framework adapter dirs does this graph touch? */
function frameworkDirsTouched(graph: Graph): Framework[] {
  const files = [...graph.srcFiles];
  return (Object.entries(FRAMEWORK_DIRS) as [Framework, string][])
    .filter(([, dir]) => files.some((file) => file.startsWith(dir + path.sep)))
    .map(([fw]) => fw);
}

/** Which framework runtimes does this graph import? */
function frameworkRuntimesImported(graph: Graph): Framework[] {
  const specs = [...graph.bareImports];
  return (Object.keys(RUNTIME_MATCHERS) as Framework[]).filter((fw) =>
    specs.some((spec) => RUNTIME_MATCHERS[fw](spec)),
  );
}

interface EntrySpec {
  name: string;
  file: string;
  /** The single framework this entry is allowed to carry, if any. */
  owns: Framework | null;
}

const ENTRIES: EntrySpec[] = [
  { name: 'vanilla (.)', file: path.join(SRC, 'blok.ts'), owns: null },
  { name: 'tools (./tools)', file: path.join(SRC, 'tools', 'index.ts'), owns: null },
  { name: 'full (./full)', file: path.join(SRC, 'full.ts'), owns: null },
  { name: 'markdown (./markdown)', file: path.join(SRC, 'markdown', 'index.ts'), owns: null },
  { name: 'react (@bloklabs/react)', file: path.join(REPO, 'packages', 'react', 'src', 'index.ts'), owns: 'react' },
  { name: 'vue (@bloklabs/vue)', file: path.join(REPO, 'packages', 'vue', 'src', 'index.ts'), owns: 'vue' },
  { name: 'angular (@bloklabs/angular)', file: path.join(REPO, 'packages', 'angular', 'src', 'index.ts'), owns: 'angular' },
];

describe('framework-weight isolation', () => {
  for (const entry of ENTRIES) {
    it(`${entry.name} pulls in no foreign framework's source`, () => {
      expect(existsSync(entry.file), `entry exists: ${entry.file}`).toBe(true);
      const graph = collectGraph(entry.file);
      const foreignDirs = frameworkDirsTouched(graph).filter((fw) => fw !== entry.owns);

      expect(foreignDirs, `${entry.name} reaches foreign adapter source: ${foreignDirs.join(', ')}`).toEqual([]);
    });

    it(`${entry.name} imports no foreign framework runtime`, () => {
      const graph = collectGraph(entry.file);
      const foreignRuntimes = frameworkRuntimesImported(graph).filter((fw) => fw !== entry.owns);

      expect(
        foreignRuntimes,
        `${entry.name} imports foreign framework runtime: ${foreignRuntimes.join(', ')}`,
      ).toEqual([]);
    });
  }

  it('detectors flag leakage rather than rubber-stamping (guard has teeth)', () => {
    // A synthetic graph that reaches BOTH react and vue source + runtimes — the
    // exact shape a real leak would produce. If the detectors returned [] here,
    // the per-entry assertions above would be meaningless.
    const leaky: Graph = {
      srcFiles: new Set([
        path.join(FRAMEWORK_DIRS.react, 'index.ts'),
        path.join(FRAMEWORK_DIRS.vue, 'index.ts'),
        path.join(FRAMEWORK_DIRS.angular, 'index.ts'),
      ]),
      bareImports: new Set(['react', 'react/jsx-runtime', 'vue', '@angular/core']),
    };

    expect(frameworkDirsTouched(leaky).sort()).toEqual(['angular', 'react', 'vue']);
    expect(frameworkRuntimesImported(leaky).sort()).toEqual(['angular', 'react', 'vue']);

    // And a clean graph trips nothing.
    const clean: Graph = {
      srcFiles: new Set([path.join(SRC, 'blok.ts')]),
      bareImports: new Set(['@bloklabs/core', 'js-cookie']),
    };
    expect(frameworkDirsTouched(clean)).toEqual([]);
    expect(frameworkRuntimesImported(clean)).toEqual([]);
  });
});
