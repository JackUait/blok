import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { expandToHierarchical } from '../../../../src/components/utils/data-model-transform';
import { LEGACY_GRAMMAR, expandLegacyBlocks } from '../../../../src/components/migration/legacy-grammar.mjs';
import type { OutputBlockData } from '../../../../types';

/**
 * Drift guard: the shared grammar interpreter (`expandLegacyBlocks`) must
 * reproduce the runtime's forward-expand output (`expandToHierarchical`)
 * EXACTLY for every legacy block type. The runtime output is the canonical
 * spec — once both the runtime and the codemod delegate to `expandLegacyBlocks`,
 * this parity makes runtime↔codemod drift structurally impossible.
 *
 * Ids are minted randomly (nanoid in the runtime, a counter here), so both
 * outputs are normalized positionally — every id/parent/content/cell-ref is
 * replaced by a `#<first-appearance-index>` token — before deep comparison.
 */

interface GrammarEntry {
  legacyType: string;
  detect(block: OutputBlockData): boolean;
  expand(block: OutputBlockData, ctx: unknown): OutputBlockData[];
}

/** A deterministic, collision-free id generator for the shared-module side. */
const makeCounterGenerator = (): (() => string) => {
  let n = 0;

  return () => `gen-${n++}`;
};

/** Replace every block id (and every reference to one) with a positional token. */
const normalizeIds = (blocks: OutputBlockData[]): OutputBlockData[] => {
  const map = new Map<string, string>();
  const tok = (id: unknown): string => {
    const key = String(id);

    if (!map.has(key)) {
      map.set(key, `#${map.size}`);
    }

    return map.get(key) as string;
  };

  // Pass 1: token every block's own id in output order.
  for (const block of blocks) {
    if (block.id != null) {
      tok(block.id);
    }
  }

  // Pass 2: rewrite ids and all references.
  return blocks.map((block) => {
    const next: OutputBlockData = { ...block };

    if (block.id != null) {
      next.id = tok(block.id);
    }
    if (block.parent != null) {
      next.parent = tok(block.parent);
    }
    if (Array.isArray(block.content)) {
      next.content = block.content.map((c) => tok(c));
    }

    // Table cell block-refs (data.content[r][c].blocks = [id, ...]).
    const data = block.data as { content?: unknown } | undefined;

    if (data && Array.isArray(data.content)) {
      next.data = {
        ...block.data,
        content: data.content.map((row: unknown): unknown =>
          Array.isArray(row)
            ? row.map((cell: unknown): unknown =>
              cell && typeof cell === 'object' && Array.isArray((cell as { blocks?: unknown }).blocks)
                ? { ...(cell as Record<string, unknown>), blocks: (cell as { blocks: unknown[] }).blocks.map((b) => tok(b)) }
                : cell
            )
            : row
        ),
      };
    }

    return next;
  });
};

/**
 * One canonical fixture per grammar entry, exercising the representative shape
 * (nested lists, container bodies, lossy fields, empty cells) so parity covers
 * the interesting branches — not just the trivial path.
 */
const FIXTURES: Record<string, OutputBlockData> = {
  list: {
    id: 'list-1',
    type: 'list',
    data: {
      style: 'ordered',
      start: 3,
      items: [
        { content: 'First', items: [{ content: 'Nested A' }, { content: 'Nested B' }] },
        { content: 'Second' },
      ],
    },
    tunes: { align: { alignment: 'left' } },
  },
  checklist: {
    id: 'check-1',
    type: 'checklist',
    data: { items: [{ text: 'Done', checked: true }, { text: 'Todo', checked: false }, 'bare string item'] },
  },
  linkTool: {
    id: 'link-1',
    type: 'linkTool',
    data: {
      link: 'https://example.com/a',
      meta: {
        title: 'T',
        description: 'D',
        image: { url: 'https://example.com/i.png' },
        favicon: 'https://example.com/f.ico',
        domain: 'example.com',
        site_name: 'Example',
      },
    },
  },
  toggleList: {
    id: 'tog-1',
    type: 'toggleList',
    data: {
      title: 'Toggle title',
      isExpanded: true,
      body: {
        blocks: [
          { id: 'inner-p', type: 'paragraph', data: { text: 'inside' } },
          { id: 'inner-list', type: 'list', data: { style: 'unordered', items: [{ content: 'x' }, { content: 'y' }] } },
        ],
      },
    },
  },
  callout: {
    id: 'call-1',
    type: 'callout',
    data: {
      variant: 'warning',
      emoji: '🔥',
      isEmojiVisible: true,
      body: { blocks: [{ id: 'call-p', type: 'paragraph', data: { text: 'note body' } }] },
    },
  },
  image: {
    id: 'img-1',
    type: 'image',
    data: { file: { url: 'https://example.com/p.png' }, caption: 'cap', withBorder: true, withBackground: true, stretched: true },
  },
  quote: {
    id: 'quote-1',
    type: 'quote',
    data: { text: 'the body', caption: 'the author', alignment: 'center' },
  },
  table: {
    id: 'tab-1',
    type: 'table',
    data: { withHeadings: true, content: [['A', ''], ['B', 'C']] },
  },
  raw: {
    id: 'raw-1',
    type: 'raw',
    data: { html: '<div>markup</div>' },
  },
  warning: {
    id: 'warn-1',
    type: 'warning',
    data: { title: 'Heads up', message: 'be careful' },
  },
  attaches: {
    id: 'att-1',
    type: 'attaches',
    data: { file: { url: 'https://example.com/file.pdf', name: 'file.pdf', size: 1234, extension: 'pdf' }, title: 'A file' },
  },
};

describe('legacy-grammar parity: shared interpreter reproduces runtime output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has a fixture for every grammar entry (coverage is exhaustive)', () => {
    const entryTypes = (LEGACY_GRAMMAR as GrammarEntry[]).map((e) => e.legacyType).sort();
    const fixtureTypes = Object.keys(FIXTURES).sort();

    expect(fixtureTypes).toEqual(entryTypes);
  });

  it.each((LEGACY_GRAMMAR as GrammarEntry[]).map((e) => e.legacyType))(
    'reproduces runtime expandToHierarchical output for %s',
    (legacyType) => {
      const fixture = FIXTURES[legacyType];
      const runtimeOut = normalizeIds(expandToHierarchical([fixture]));
      const sharedOut = normalizeIds(
        expandLegacyBlocks([fixture], { generateId: makeCounterGenerator(), warn: () => undefined })
      );

      expect(sharedOut).toEqual(runtimeOut);
    }
  );

  it('reproduces runtime output for a full multi-type document (cross-type ordering)', () => {
    const doc = Object.values(FIXTURES);
    const runtimeOut = normalizeIds(expandToHierarchical(doc));
    const sharedOut = normalizeIds(
      expandLegacyBlocks(doc, { generateId: makeCounterGenerator(), warn: () => undefined })
    );

    expect(sharedOut).toEqual(runtimeOut);
  });

  it('every grammar entry is reachable: its fixture triggers exactly that entry first', () => {
    for (const entry of LEGACY_GRAMMAR as GrammarEntry[]) {
      const fixture = FIXTURES[entry.legacyType];
      const firstMatch = (LEGACY_GRAMMAR as GrammarEntry[]).find((e) => e.detect(fixture));

      expect(firstMatch?.legacyType).toBe(entry.legacyType);
    }
  });
});
