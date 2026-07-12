import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { defaultBlockTools } from '../../../src/tools';

/**
 * MARKDOWN SERIALIZATION LAW
 *
 * Every registered block tool must have a deliberate Markdown serialization:
 * either a `case '<tool>':` in `blockToMarkdown` (src/markdown/blocks-to-markdown.ts)
 * or an explicit, reasoned exemption below.
 *
 * Why: `blockToMarkdown` ends in a `default:` branch that emits `data.text`. A tool
 * that carries no `data.text` (table, image, video, file, embed …) therefore
 * serialized to an EMPTY STRING — silently, with no error. That is exactly how the
 * table block ended up unable to leave the editor: copy-as-markdown and a markdown
 * round-trip both dropped it entirely.
 *
 * A new tool must not be able to reintroduce that hole by omission.
 */

const SOURCE_PATH = resolve(__dirname, '../../../src/markdown/blocks-to-markdown.ts');

/**
 * Exempt tools, each with the reason its Markdown output is intentionally not a
 * dedicated case. An exemption is a DECISION, not a TODO — if a tool loses data
 * by being exempt, it does not belong here.
 */
const EXEMPT_TOOLS: Record<string, string> = {
  paragraph: 'A paragraph IS plain Markdown text: the default branch emits its inline text (bold/italic/links included). A dedicated case would be a no-op.',
  callout: 'Text-bearing block with no Markdown block syntax. The default branch emits its `data.text`, so no content is lost — only the callout chrome.',
  toggle: 'Text-bearing block with no Markdown block syntax. The default branch emits its `data.text` (the summary line); its children are separate blocks that serialize themselves.',
  column_list: 'Structural container with no content of its own. Its column children hold the blocks, which serialize themselves in document order.',
  column: 'Structural container with no content of its own. Its child blocks serialize themselves in document order.',
  spacer: 'A spacer is pure vertical whitespace — it has no content to serialize, and Markdown has no representation for a gap. Emitting an empty line is correct.',
  database: 'A database block stores schema + view configs; its rows are child `database-row` blocks. A GFM pipe table cannot express schemas, views or property types, and a lossy half-table would be worse than the current omission. Deliberately not serialized.',
  'database-row': 'Row values live in `data.properties`, whose meaning depends on the parent database schema. Serialized only if/when the database block gains a Markdown representation.',
};

/**
 * The `case '<tool>':` labels inside `blockToMarkdown`. The file also switches on
 * inline TAG names (b/i/code/a …) in `serializeInlineNode`, so the scan is scoped
 * to the block-level serializer.
 * @returns tool names with a dedicated serialization case
 */
const readSerializedTools = (): Set<string> => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const start = source.indexOf('const blockToMarkdown');
  const end = source.indexOf('const buildContext');

  expect(start, 'blockToMarkdown must exist in blocks-to-markdown.ts').toBeGreaterThan(-1);
  expect(end, 'buildContext must follow blockToMarkdown (scan boundary)').toBeGreaterThan(start);

  const region = source.slice(start, end);
  const tools = new Set<string>();

  for (const match of region.matchAll(/case '([a-z0-9_-]+)':/g)) {
    tools.add(match[1]);
  }

  return tools;
};

describe('Markdown serialization law', () => {
  const registeredTools = Object.keys(defaultBlockTools);

  it('every registered block tool is either serialized or explicitly exempt', () => {
    const serialized = readSerializedTools();
    const undecided = registeredTools.filter(
      (tool) => !serialized.has(tool) && EXEMPT_TOOLS[tool] === undefined
    );

    expect(
      undecided,
      `These block tools have no Markdown serialization case in src/markdown/blocks-to-markdown.ts and no exemption. ` +
      `They currently serialize to their (possibly empty) \`data.text\`. Add a \`case '<tool>':\` to blockToMarkdown, ` +
      `or add a reasoned exemption to EXEMPT_TOOLS in this file.`
    ).toEqual([]);
  });

  it('the table tool is serialized (the regression this law exists for)', () => {
    expect(readSerializedTools().has('table')).toBe(true);
  });

  it('every exemption names a real, still-unserialized tool (no stale exemptions)', () => {
    const serialized = readSerializedTools();

    for (const [tool, reason] of Object.entries(EXEMPT_TOOLS)) {
      expect(registeredTools, `Exempt tool "${tool}" is not a registered block tool`).toContain(tool);
      expect(
        serialized.has(tool),
        `"${tool}" now has a serialization case — remove its stale exemption`
      ).toBe(false);
      expect(reason.length, `Exemption for "${tool}" needs a real reason`).toBeGreaterThan(40);
    }
  });
});
