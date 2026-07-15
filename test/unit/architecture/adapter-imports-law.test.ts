import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Adapter import law: framework adapters may only reach the core through its
 * public specifiers (`@blok/core`, `@blok/core/adapters`, `@/types`), never
 * through relative paths into core source. This is what makes each adapter
 * extractable into its own workspace package with `@blok/core` externalized.
 */
describe('adapter import law', () => {
  it.each(['src/react', 'src/vue', 'src/angular'])(
    '%s has no relative imports into core source',
    (dir) => {
      // git grep exits 1 when there are no matches — that's the passing case
      let hits = '';

      try {
        hits = execFileSync('git', ['grep', '-nE', "from '\\.\\.", '--', dir], { encoding: 'utf-8' });
      } catch {
        // no matches
      }

      expect(hits).toBe('');
    },
  );
});
