import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { htmlToSegmentsDom } from '../../../src/components/utils/rich-text-dom';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';

/**
 * The collab fixture generator runs in node and parses rich-field HTML with
 * parse5, while the browser client mints with the DOM parser. The fixtures
 * only pin what the client writes if both parsers agree on every input.
 */
const ROOT = join(process.cwd(), 'test/unit/server-conformance/fixtures');

const richStrings = (folder: string): Array<{ where: string; html: string }> =>
  readdirSync(join(ROOT, folder), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap((entry) => {
      const blocks: unknown = JSON.parse(readFileSync(join(ROOT, folder, entry.name, 'input.json'), 'utf8'));

      return (Array.isArray(blocks) ? blocks : []).flatMap((block: { id?: unknown; type?: unknown; data?: Record<string, unknown> }) => {
        const fields = typeof block?.type === 'string' ? CURRENT_RICH_TEXT_FIELDS[block.type] ?? [] : [];

        return fields
          .map(field => block.data?.[field])
          .filter((html): html is string => typeof html === 'string')
          .map(html => ({ where: `${folder}/${entry.name}/${String(block.id)}`, html }));
      });
    });

describe('collab fixtures: DOM and parse5 read rich fields alike', () => {
  const inputs = [...richStrings('collab'), ...richStrings('collab-format1')];

  it('finds rich inputs to compare', () => {
    expect(inputs.length).toBeGreaterThan(20);
  });

  it.each(inputs)('$where', ({ html }) => {
    expect(htmlToSegmentsNode(html)).toEqual(htmlToSegmentsDom(html));
  });
});
