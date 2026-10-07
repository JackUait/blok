import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No first-party link may point at `/docs#<module>` or `/tools#<tool>`.
 *
 * The docs hub has no such fragments. `ApiIndexRedirect` maps them to the real
 * route in JS, so a crawler and a no-JS reader land on the hub instead, and
 * every hop costs a redirect. `/tools#<tool>` is the same: ToolsRedirect
 * maps it to `/docs/<tool>` in JS. Link the route itself: `/docs/quick-start`.
 */
const SRC = resolve(process.cwd(), 'src');

const EXEMPT: Record<string, string> = {
  'components/api/ApiIndexRedirect.tsx':
    'handles the legacy hashes for inbound historical links; its doc comment names one',
  'routes/tools.tsx': 'ToolsRedirect handles the legacy /tools# hashes for inbound links',
};

const LEGACY_HASH = /(?:\/ru)?\/(?:docs|tools)\/?#[\w-]+/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__fixtures__' ? [] : sourceFiles(full);
    return /\.(tsx?|json|md)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

describe('legacy docs hash law', () => {
  it('links docs modules by route, not by a legacy /docs# or /tools# hash', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => EXEMPT[relative(SRC, file)] === undefined)
      .flatMap((file) =>
        (readFileSync(file, 'utf8').match(LEGACY_HASH) ?? []).map(
          (hit) => `${relative(SRC, file)}: ${hit}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  // Guards against a glob that silently matches nothing.
  it('scans the components and the locale files', () => {
    const files = sourceFiles(SRC).map((file) => relative(SRC, file));
    expect(files).toContain('components/layout/Footer.tsx');
    expect(files).toContain('i18n/ru.json');
  });
});
