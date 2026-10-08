import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

// Fail-loud guard: after all rewrites, no staged .ts source file should still contain
// a relative import whose specifier points into the core types/ or markdown/types tree.
// rewriteTypeImports() uses single-line `import type { }` regexes and would silently
// miss multi-line type imports or inline-`type` modifiers in mixed imports.  This scan
// catches those misses immediately with a clear diagnostic instead of a cryptic ng-packagr
// compile error downstream.
const gatherTsSourceFiles = (dir) => {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...gatherTsSourceFiles(full));
    // Skip generated .d.ts files — they are declaration stubs, not source.
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) results.push(full);
  }
  return results;
};

/**
 * Throws when a staged .ts file still imports the core types/ or markdown/types tree.
 * @param {string} stagingDir - the Angular staging root
 */
export const assertNoLeakedCoreTypeImports = (stagingDir) => {
  for (const tsFile of gatherTsSourceFiles(stagingDir)) {
    const src = readFileSync(tsFile, 'utf8');
    // Match any 'from' clause with a relative specifier that goes UP at least one
    // directory level (starts with ../), or one using the repo's '@/' alias.
    // Specifiers that only descend (./foo) are intra-staging and are fine (e.g.
    // './types' → angular/types.ts is staged). A '/types' path that resolves to a
    // staged file (shared/table/types.ts) is intra-staging too; any other is a
    // leaked reference that should have been rewritten to '@bloklabs/core'. The '@/' arm matters because
    // the staging tsconfig has no '@/*' mapping: an unrewritten '@/types' import
    // is a straight TS2307, which is how blok-instance.ts broke the build.
    const re = /from\s+['"]((?:\.\.\/)+[^'"]+|@\/[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      const resolved = path.resolve(path.dirname(tsFile), spec);
      // Inside stagingDir only: a path that climbs out could reach the repo-root types/ tree.
      const staged =
        !spec.startsWith('@/') &&
        !path.relative(stagingDir, resolved).startsWith('..') &&
        (existsSync(`${resolved}.ts`) || existsSync(path.join(resolved, 'index.ts')));
      if (
        !staged &&
        (spec.includes('/types/') ||
        spec.endsWith('/types') ||
        /\/markdown\/types/.test(spec))
      ) {
        const rel = path.relative(stagingDir, tsFile);
        throw new Error(
          `[build-angular] Leftover core type import in staged file '${rel}': ` +
          `'${spec}' was not rewritten to '@bloklabs/core'. ` +
          `Check rewriteTypeImports() — the import may be multi-line or use an inline 'type' modifier.`
        );
      }
    }
  }
};
