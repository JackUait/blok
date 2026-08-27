import { describe, it, expect } from 'vitest';

import { blocksToMarkdown as domBlocksToMarkdown } from '../../../src/markdown/blocks-to-markdown';
import { blocksToMarkdown as viewBlocksToMarkdown } from '../../../src/view/blocks-to-markdown';

import type { SerializableBlock } from '../../../src/markdown/blocks-to-markdown-core';
import type { OutputBlockData, OutputData } from '../../../types';

/**
 * PARITY LAW — the DOM and parse5 inline backends must produce identical Markdown.
 *
 * Two backends exist because the editor cannot ship parse5 (bundle weight) and the
 * view renderer cannot touch a DOM (it runs in bare Node, workers, RSC and Jint).
 * Every block-level decision is shared in `blocks-to-markdown-core.ts`, so the only
 * place they can diverge is how a block's inline HTML is read — which is exactly
 * what these fixtures exercise. A divergence here means a document copied out of
 * the editor and the same document exported server-side no longer agree.
 */

/**
 * Flatten a document into the editor serializer's input, computing each block's
 * `indent` from its parent chain — the same mapping `blocks.exportMarkdown()` does.
 * @param data - the fixture document
 */
const toSerializable = (data: OutputData): SerializableBlock[] => {
  const parentOf = new Map<string, string | null>();

  for (const block of data.blocks) {
    if (block.id !== undefined) {
      parentOf.set(block.id, block.parent ?? null);
    }
  }

  /**
   * Parent-chain depth of a block.
   * @param id - block id
   * @param seen - ids already walked (cycle guard)
   */
  const depthOf = (id: string | undefined, seen: Set<string> = new Set()): number => {
    if (id === undefined || seen.has(id)) {
      return 0;
    }

    const parent = parentOf.get(id);

    if (typeof parent !== 'string') {
      return 0;
    }

    seen.add(id);

    return 1 + depthOf(parent, seen);
  };

  return data.blocks.map((block) => ({
    id: block.id,
    tool: block.type,
    data: block.data,
    parentId: block.parent ?? null,
    indent: depthOf(block.id),
  }));
};

/**
 * Wrap blocks into an OutputData envelope.
 * @param blocks - blocks for the document
 */
const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

const FIXTURES: Array<{ name: string; document: OutputData }> = [
  {
    name: 'nested inline marks',
    document: doc([{ type: 'paragraph', data: { text: '<b>bold <i>and italic</i></b> plus <code>code</code>' } }]),
  },
  {
    name: 'a link wrapping marks',
    document: doc([{ type: 'paragraph', data: { text: '<a href="https://x.com/a?b=1&amp;c=2">go <b>now</b></a>' } }]),
  },
  {
    name: 'HTML entities and a hard break',
    document: doc([{ type: 'paragraph', data: { text: 'a &lt; b &amp;&nbsp;c<br>second line' } }]),
  },
  {
    name: 'marks holding only whitespace',
    document: doc([{ type: 'paragraph', data: { text: 'x <b> </b><i></i><s>  </s> y' } }]),
  },
  {
    name: 'an unknown inline wrapper',
    document: doc([{ type: 'paragraph', data: { text: '<span class="mark"><u>kept</u></span>' } }]),
  },
  {
    name: 'an inline equation reading as its source',
    document: doc([{ type: 'paragraph', data: { text: 'mass: <span data-latex="E=mc^2">E=mc2E=mc^2E=mc2</span>' } }]),
  },
  {
    name: 'unbalanced markup',
    document: doc([{ type: 'paragraph', data: { text: 'broken <b>bold <i>both</b> tail' } }]),
  },
  {
    name: 'a code block carrying escaped HTML',
    document: doc([{ type: 'code', data: { code: 'if (a &lt; b) {\n  return "&amp;";\n}' } }]),
  },
  {
    name: 'headings, quotes, dividers and lists',
    document: doc([
      { id: 'h', type: 'header', data: { text: 'Title <b>bold</b>', level: 2 } },
      { id: 'q', type: 'quote', data: { text: 'quoted <i>text</i>' } },
      { id: 'd', type: 'divider', data: {} },
      { id: 'l1', type: 'list', data: { text: 'one', style: 'unordered' } },
      { id: 'l2', type: 'list', data: { text: 'nested <code>x</code>', style: 'ordered' }, parent: 'l1' },
    ]),
  },
  {
    name: 'a callout with several children',
    document: doc([
      { id: 'cal', type: 'callout', data: { emoji: '⚠️' } },
      { id: 'c1', type: 'paragraph', data: { text: 'First <b>line</b>' }, parent: 'cal' },
      { id: 'c2', type: 'list', data: { text: 'point', style: 'unordered' }, parent: 'cal' },
    ]),
  },
  {
    name: 'a toggle with a nested list',
    document: doc([
      { id: 'tg', type: 'toggle', data: { text: 'More <i>details</i>' } },
      { id: 't1', type: 'list', data: { text: 'a', style: 'unordered' }, parent: 'tg' },
      { id: 't2', type: 'list', data: { text: 'b', style: 'unordered' }, parent: 't1' },
    ]),
  },
  {
    name: 'columns holding blocks',
    document: doc([
      { id: 'cl', type: 'column_list', data: {} },
      { id: 'col1', type: 'column', data: {}, parent: 'cl' },
      { id: 'p1', type: 'paragraph', data: { text: 'Left <b>side</b>' }, parent: 'col1' },
      { id: 'col2', type: 'column', data: {}, parent: 'cl' },
      { id: 'p2', type: 'header', data: { text: 'Right', level: 3 }, parent: 'col2' },
    ]),
  },
  {
    name: 'a table with block-backed and legacy cells',
    document: doc([
      {
        id: 'tbl',
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            [{ text: 'A | pipe' }, { blocks: ['cell1'] }],
            [{ text: '<b>bold</b>' }, { text: 'plain' }],
          ],
        },
      },
      { id: 'cell1', type: 'paragraph', data: { text: 'in <i>cell</i>' }, parent: 'tbl' },
    ]),
  },
  {
    name: 'media, embeds and bookmarks',
    document: doc([
      { type: 'image', data: { url: 'https://i/x.png', caption: 'A <b>shot</b>' } },
      { type: 'video', data: { url: 'https://v/x.mp4' } },
      { type: 'file', data: { url: 'https://f/x.pdf', fileName: 'x.pdf' } },
      { type: 'bookmark', data: { url: 'https://x.com', title: 'X' } },
      { type: 'embed', data: { source: 'https://y.com', service: 'youtube' } },
    ]),
  },
  {
    name: 'a spacer between paragraphs',
    document: doc([
      { type: 'paragraph', data: { text: 'A' } },
      { type: 'spacer', data: {} },
      { type: 'paragraph', data: { text: 'B' } },
    ]),
  },
];

describe('blocksToMarkdown backend parity', () => {
  it.each(FIXTURES)('DOM and parse5 agree on $name', ({ document: fixture }) => {
    expect(viewBlocksToMarkdown(fixture)).toBe(domBlocksToMarkdown(toSerializable(fixture)));
  });

  it('covers every tool that has a dedicated serialization case', () => {
    const covered = new Set(FIXTURES.flatMap(({ document: fixture }) => fixture.blocks.map((block) => block.type)));

    for (const tool of ['header', 'quote', 'divider', 'list', 'code', 'table', 'callout', 'toggle', 'column_list', 'column', 'spacer', 'image', 'video', 'file', 'bookmark', 'embed']) {
      expect(covered, `no parity fixture exercises the \`${tool}\` tool`).toContain(tool);
    }
  });
});
