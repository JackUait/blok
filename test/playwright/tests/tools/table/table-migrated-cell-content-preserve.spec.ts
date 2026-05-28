// spec: Migrated table cell content survives an unedited load→save round-trip
// seed: test/playwright/tests/tools/table/table-readonly-toggle.spec.ts
//
// Regression for the "knowledge base migration" data-loss bug: articles migrated
// from the old (Summernote/HTML) knowledge base store tables in blok's flat-ref
// shape — each cell holds only child-block IDs (`{ blocks: [<id>] }`, with NO
// `text` fallback), and the actual cell text lives in sibling paragraph blocks
// that reference the table by id. Crucially, the migrated children do NOT carry a
// `parent` field. Opening such an article and saving WITHOUT editing the table
// must not drop the cell text.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';

const HOLDER_ID = 'blok';

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
  readOnly?: boolean;
};

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data = null, tools = {}, readOnly = false } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig, readOnly: isReadOnly }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
        readOnly: isReadOnly,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<
          Record<string, { class: unknown } & Record<string, unknown>>
        >((accumulator, { name, className, config }) => {
          let toolClass: unknown = null;

          if (className) {
            toolClass = className.split('.').reduce(
              (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
              window
            ) ?? null;
          }

          if (!toolClass) {
            throw new Error(`Tool "${name}" is not available globally`);
          }

          return {
            ...accumulator,
            [name]: {
              class: toolClass,
              ...config,
            },
          };
        }, {});

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
      readOnly,
    }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

// The metadata table from the migrated dodopizza article 56d1d3e0… — 4 rows × 2
// cols. Each cell references a child paragraph by id; children carry NO `parent`
// field and cells have NO `text` fallback (exactly as produced by the
// HTML→blok migration before any edit-mode re-save backfills `parent`).
const EXPECTED_CELL_TEXTS = [
  '<strong>Автор статьи</strong>',
  'Егор Смазнов',
  '<strong>Цель статьи</strong>',
  'Ознакомить партнеров и лидеров кофеен с правилами установки принтера этикеток',
  '<strong>Для кого статья</strong>',
  'Партнерам и лидерам кофеен',
  '<strong>Для каких стран</strong>',
  'Россия',
];

const migratedTableData = (): OutputData => {
  const childIds = EXPECTED_CELL_TEXTS.map((_, i) => `cell-child-${i + 1}`);

  const tableBlock = {
    id: 'migrated-table',
    type: 'table',
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      stretched: false,
      content: [
        [{ blocks: [childIds[0]] }, { blocks: [childIds[1]] }],
        [{ blocks: [childIds[2]] }, { blocks: [childIds[3]] }],
        [{ blocks: [childIds[4]] }, { blocks: [childIds[5]] }],
        [{ blocks: [childIds[6]] }, { blocks: [childIds[7]] }],
      ],
    },
  };

  // Sibling paragraph blocks holding the real text — NO `parent` field.
  const childBlocks = EXPECTED_CELL_TEXTS.map((text, i) => ({
    id: childIds[i],
    type: 'paragraph',
    data: { text },
  }));

  return { blocks: [tableBlock, ...childBlocks] } as OutputData;
};

// A migrated table mixing realistic shapes the deterministic converter emits:
// a cell with MULTIPLE child blocks (e.g. a `<ul>` cell → one block per `<li>`)
// and an EMPTY cell (`blocks: []`, e.g. an empty `<td>`), alongside normal
// single-child cells. Children carry NO `parent` field.
const MIXED_BLOCK_TEXTS = ['Multi child A', 'Multi child B', 'Single one', 'Single two'];

const mixedTableData = (): OutputData => {
  const tableBlock = {
    id: 'mixed-table',
    type: 'table',
    data: {
      withHeadings: false,
      withHeadingColumn: false,
      stretched: false,
      content: [
        [{ blocks: ['m1', 'm2'] }, { blocks: ['m3'] }],
        [{ blocks: [] as string[] }, { blocks: ['m4'] }],
      ],
    },
  };

  const childBlocks = [
    { id: 'm1', type: 'paragraph', data: { text: 'Multi child A' } },
    { id: 'm2', type: 'paragraph', data: { text: 'Multi child B' } },
    { id: 'm3', type: 'paragraph', data: { text: 'Single one' } },
    { id: 'm4', type: 'paragraph', data: { text: 'Single two' } },
  ];

  return { blocks: [tableBlock, ...childBlocks] } as OutputData;
};

const saveBlok = (page: Page): Promise<OutputData> =>
  page.evaluate(async () => {
    const blok = window.blokInstance;

    if (!blok) {
      throw new Error('Blok instance not found');
    }

    return await blok.save();
  });

// Resolve, from saved output, the text of every block referenced by a table
// cell. A dropped child (missing block or empty text) is the data-loss signature.
const cellTexts = (saved: OutputData): Array<string | null> => {
  const byId = new Map(saved.blocks.map(b => [b.id, b]));
  const table = saved.blocks.find(b => b.type === 'table');

  if (!table) {
    throw new Error('table block missing from saved output');
  }

  const rows = (table.data as { content: Array<Array<{ blocks?: string[] }>> }).content;
  const out: Array<string | null> = [];

  for (const row of rows) {
    for (const cell of row) {
      for (const id of cell.blocks ?? []) {
        const child = byId.get(id);

        out.push((child?.data as { text?: string } | undefined)?.text ?? null);
      }
    }
  }

  return out;
};

test.describe('Migrated table cell content preservation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('edit-mode load → save with zero edits keeps all cell text', async ({ page }) => {
    await createBlok(page, { tools: defaultTools, data: migratedTableData() });

    const texts = cellTexts(await saveBlok(page));

    for (const expected of EXPECTED_CELL_TEXTS) {
      expect(texts).toContain(expected);
    }
    expect(texts.filter(t => t === null || t === '')).toHaveLength(0);
  });

  test('published (read-only) → edit toggle → save keeps all cell text', async ({ page }) => {
    // Mirrors the video: article opened from the published (read-only) view, then
    // switched to edit mode, then saved+published without touching the table.
    await createBlok(page, { tools: defaultTools, readOnly: true, data: migratedTableData() });

    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === false);

    const texts = cellTexts(await saveBlok(page));

    for (const expected of EXPECTED_CELL_TEXTS) {
      expect(texts).toContain(expected);
    }
    expect(texts.filter(t => t === null || t === '')).toHaveLength(0);
  });

  test('read-only → edit toggle → save keeps multi-child and single cells (empty stays empty)', async ({ page }) => {
    // Covers shapes the deterministic migration emits beyond the simple 1-child
    // cell: a cell with multiple child blocks (a `<ul>`/`<ol>` cell) and an empty
    // cell, mixed with single-child cells — through the vulnerable read-only→edit path.
    await createBlok(page, { tools: defaultTools, readOnly: true, data: mixedTableData() });

    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle();
    });
    await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === false);

    const texts = cellTexts(await saveBlok(page));

    // Every populated child survives — including BOTH blocks of the multi-child cell.
    for (const expected of MIXED_BLOCK_TEXTS) {
      expect(texts).toContain(expected);
    }
    // No populated reference resolved to empty/missing text.
    expect(texts.filter(t => t === null || t === '')).toHaveLength(0);
    // Exactly the 4 populated references survive (the empty cell adds none).
    expect(texts).toHaveLength(MIXED_BLOCK_TEXTS.length);
  });
});
