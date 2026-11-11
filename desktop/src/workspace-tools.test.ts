import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The desktop registers its own tool map, so a block the core ships is absent
 * from the app until it is named here. `code` was missing: the app could not
 * show a single snippet, which made it useless for writing about a codebase —
 * and the core's code tool carries Prism highlighting, line numbers, language
 * detection and mermaid rendering, none of which were reachable.
 *
 * The rest are what documentation is written with: callouts for the "why",
 * toggles for detail a reader can fold away, quotes and dividers.
 */
describe('desktop tool registry', () => {
  const source = readFileSync(join(process.cwd(), 'src/workspace.ts'), 'utf8');

  it.each(['code', 'callout', 'toggle', 'quote', 'divider'])('registers the %s block', (tool) => {
    expect(source).toMatch(new RegExp(`\\b${tool}:\\s*\\{\\s*class:`, 'i'));
  });

  it('still registers the database and page blocks it already had', () => {
    for (const tool of ['table', 'database', 'database-row', 'database-comment']) {
      expect(source).toContain(`'${tool}'`.replace(/^'([a-z]+)'$/, '$1'));
    }
    expect(source).toMatch(/page:\s*\{\s*class:\s*Page/);
  });
});
