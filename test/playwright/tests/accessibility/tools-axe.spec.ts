/**
 * Breadth-first axe-core coverage for every registered block tool, scanned in
 * edit mode and again in read-only mode, plus a kitchen-sink document and a
 * nested-container document.
 *
 * Each scan is scoped with `include` to the block wrappers of the tool under
 * test — `data-blok-component` carries the tool name on every block wrapper
 * (src/components/block/tool-renderer.ts). Scoping keeps the editor chrome
 * (toolbar, popovers) and the bare fixture page's missing landmarks out of the
 * result, so a red here is a defect in the tool's own DOM.
 *
 * A scoped scan whose `include` selector matches nothing passes VACUOUSLY, so
 * every scan is preceded by a real presence assertion on the same subtree.
 *
 * Every remote asset is local: the Playwright webServer serves the repo root on
 * :4444, and image/video route a media `error` event to a terminal state that
 * tears the media element out of the DOM — a dead URL would silently empty the
 * very subtree under scan.
 */
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { expectNoA11yViolations } from '../helpers/a11y';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';

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

const createBlok = async (
  page: Page,
  options: { data?: OutputData; config?: Record<string, unknown> } = {}
): Promise<void> => {
  const { data = null, config = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, config: providedConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        autofocus: true,
        ...providedConfig,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      initialData: data,
      config,
    }
  );
};

/** Autofocus has nothing to focus once the editor is locked, so it is dropped. */
const READ_ONLY_CONFIG = { readOnly: true, autofocus: false };

/** Every block wrapper of a given tool, scoped to the editor. */
const blocksOf = (tool: string): string => `${BLOK_INTERFACE_SELECTOR} [data-blok-component="${tool}"]`;

/** The block area — excludes the toolbar/gutter chrome that lives beside it. */
const REDACTOR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-redactor]`;

const ORIGIN = 'http://localhost:4444';
const SAMPLE_IMAGE_URL = `${ORIGIN}/test/playwright/fixtures/image/shot.png`;
const SAMPLE_VIDEO_URL = `${ORIGIN}/public/samples/big-buck-bunny.mp4`;
const SAMPLE_AUDIO_URL = `${ORIGIN}/test/playwright/fixtures/audio/sample.mp3`;
const SAMPLE_TEXT_FILE_URL = `${ORIGIN}/public/samples/release-notes.txt`;

/**
 * A 1×1 transparent GIF. Keeps the bookmark favicon offline — the unfurl
 * endpoint is only consulted on paste, never for stored data.
 */
const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * A host that resolves to nothing, so the framed embed never pulls third-party
 * markup into the scan (axe descends into same-origin frames). The origin is
 * allowlisted per-test so the tool frames it for real instead of degrading to
 * its link card.
 */
const FRAMED_EMBED_URL = 'https://dashboard.example.com/widget/42';
const FRAMED_EMBED_CONFIG = { linkPaste: { allowedEmbedOrigins: ['dashboard.example.com'] } };

/**
 * The inline tools whose rendered markup is clean today. Split from
 * {@link CODE_AND_LINK_TEXT} so `inlineCode`/`link`'s contrast defect does not
 * blanket the other five marks in a `fixme`.
 */
const SAFE_MARKS_TEXT =
  'Plain text, <b>bold</b>, <i>italic</i>, <u>underline</u>, <s>strikethrough</s> '
  + 'and <mark style="background-color: rgb(251, 243, 219);">marker</mark>.';

const CODE_AND_LINK_TEXT =
  'Inline <code>const answer = 42</code> and <a href="https://example.com/docs">a documentation link</a>.';

interface ToolCase {
  /** Unique test-title fragment. */
  name: string;
  /** `data-blok-component` value the scan is scoped to. */
  tool: string;
  blocks: OutputData['blocks'];
  /** How many wrappers of `tool` the document renders. */
  count: number;
  /** Extra editor config the fixture needs in both modes. */
  config?: Record<string, unknown>;
  /**
   * axe rule ids the tool's own DOM fails TODAY, per mode. A non-empty list
   * declares the test `fixme` — the fixture stays in the file, and the rule id
   * stays visible, instead of the finding being waived into a green run.
   */
  knownViolations?: { edit?: readonly string[]; readOnly?: readonly string[] };
}

const knownFor = (toolCase: ToolCase, mode: 'edit' | 'readOnly'): readonly string[] =>
  (mode === 'edit' ? toolCase.knownViolations?.edit : toolCase.knownViolations?.readOnly) ?? [];

const DATABASE_BLOCKS: OutputData['blocks'] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: 'opt-backlog', label: 'Backlog', color: 'gray', position: 'a0' },
              { id: 'opt-done', label: 'Done', color: 'green', position: 'a1' },
            ],
          },
        },
      ],
      views: [
        {
          id: 'view-1',
          name: 'Board',
          type: 'board',
          position: 'a0',
          groupBy: 'prop-status',
          sorts: [],
          filters: [],
          visibleProperties: ['prop-title', 'prop-status'],
        },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1', 'row-2'],
  },
  {
    id: 'row-1',
    type: 'database-row',
    parent: 'db-1',
    data: { position: 'a0', properties: { 'prop-title': 'Fix bug', 'prop-status': 'opt-backlog' } },
  },
  {
    id: 'row-2',
    type: 'database-row',
    parent: 'db-1',
    data: { position: 'a1', properties: { 'prop-title': 'Write tests', 'prop-status': 'opt-done' } },
  },
];

const COLUMN_BLOCKS: OutputData['blocks'] = [
  { id: 'cl-1', type: 'column_list', data: {}, content: ['col-1', 'col-2'] },
  { id: 'col-1', type: 'column', data: {}, parent: 'cl-1', content: ['col-1-p'] },
  { id: 'col-1-p', type: 'paragraph', data: { text: 'Left column body.' }, parent: 'col-1' },
  { id: 'col-2', type: 'column', data: {}, parent: 'cl-1', content: ['col-2-p'] },
  { id: 'col-2-p', type: 'paragraph', data: { text: 'Right column body.' }, parent: 'col-2' },
];

/**
 * Deliberately list-free: the list tool's own `aria-required-parent` defect
 * would otherwise mask whether the toggle's chrome is clean. Lists inside a
 * toggle are covered by the nested-container document.
 */
const TOGGLE_BLOCKS: OutputData['blocks'] = [
  {
    id: 'tog-1',
    type: 'toggle',
    data: { text: 'Release checklist', isOpen: true },
    content: ['tog-1-h', 'tog-1-p'],
  },
  { id: 'tog-1-h', type: 'header', data: { text: 'Nested heading', level: 3 }, parent: 'tog-1' },
  { id: 'tog-1-p', type: 'paragraph', data: { text: 'Nested paragraph.' }, parent: 'tog-1' },
];

const CALLOUT_BLOCKS: OutputData['blocks'] = [
  {
    id: 'cal-1',
    type: 'callout',
    data: { emoji: '💡', backgroundColor: 'blue' },
    content: ['cal-1-h', 'cal-1-p'],
  },
  { id: 'cal-1-h', type: 'header', data: { text: 'Good to know', level: 3 }, parent: 'cal-1' },
  { id: 'cal-1-p', type: 'paragraph', data: { text: 'Callouts hold child blocks.' }, parent: 'cal-1' },
];

const TOOL_CASES: ToolCase[] = [
  {
    name: 'paragraph (bold, italic, underline, strikethrough, marker)',
    tool: 'paragraph',
    count: 2,
    blocks: [
      { type: 'paragraph', data: { text: SAFE_MARKS_TEXT } },
      { type: 'paragraph', data: { text: 'A second, unstyled paragraph.' } },
    ],
  },
  {
    name: 'paragraph (inline code and link)',
    tool: 'paragraph',
    count: 1,
    knownViolations: { edit: ['color-contrast'], readOnly: ['color-contrast'] },
    blocks: [
      { type: 'paragraph', data: { text: CODE_AND_LINK_TEXT } },
    ],
  },
  {
    name: 'header',
    tool: 'header',
    count: 4,
    blocks: [
      { type: 'header', data: { text: 'Level one', level: 1 } },
      { type: 'header', data: { text: 'Level two', level: 2 } },
      { type: 'header', data: { text: 'Level three', level: 3 } },
      {
        id: 'th-1',
        type: 'header',
        data: { text: 'Toggleable heading', level: 2, isToggleable: true, isOpen: true },
        content: ['th-1-p'],
      },
      { id: 'th-1-p', type: 'paragraph', data: { text: 'Body under the toggle heading.' }, parent: 'th-1' },
    ],
  },
  {
    name: 'list (unordered, ordered, checklist, nested)',
    tool: 'list',
    count: 6,
    knownViolations: { edit: ['aria-required-parent'], readOnly: ['aria-required-parent'] },
    blocks: [
      { type: 'list', data: { text: 'Unordered one', style: 'unordered' } },
      { type: 'list', data: { text: 'Unordered nested', style: 'unordered' }, indent: 1 },
      { type: 'list', data: { text: 'Ordered one', style: 'ordered' } },
      { type: 'list', data: { text: 'Ordered two', style: 'ordered' } },
      { type: 'list', data: { text: 'Done task', style: 'checklist', checked: true } },
      { type: 'list', data: { text: 'Open task', style: 'checklist', checked: false } },
    ],
  },
  {
    name: 'table',
    tool: 'table',
    count: 1,
    blocks: [
      {
        type: 'table',
        data: {
          withHeadings: true,
          content: [
            ['Region', 'Owner', 'Status'],
            ['EMEA', 'Ada', 'Shipped'],
            ['APAC', 'Grace', 'In review'],
          ],
        },
      },
    ],
  },
  {
    name: 'toggle',
    tool: 'toggle',
    count: 1,
    blocks: TOGGLE_BLOCKS,
  },
  {
    name: 'callout',
    tool: 'callout',
    count: 1,
    blocks: CALLOUT_BLOCKS,
  },
  {
    name: 'database',
    tool: 'database',
    count: 1,
    knownViolations: {
      edit: ['button-name', 'color-contrast'],
      readOnly: ['color-contrast'],
    },
    blocks: DATABASE_BLOCKS,
  },
  {
    name: 'quote',
    tool: 'quote',
    count: 2,
    blocks: [
      { type: 'quote', data: { text: 'Everything is a block.', size: 'default' } },
      { type: 'quote', data: { text: 'A large pull quote.', size: 'large' } },
    ],
  },
  {
    name: 'code',
    tool: 'code',
    count: 1,
    knownViolations: { edit: ['color-contrast'], readOnly: ['color-contrast'] },
    blocks: [
      {
        type: 'code',
        data: {
          code: 'const answer = 42;\n\nexport function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
          language: 'javascript',
        },
      },
    ],
  },
  {
    name: 'image',
    tool: 'image',
    count: 1,
    // The caption textbox is rendered for EVERY image, captioned or not, so
    // there is no caption-free variant of this tool that could pass today.
    knownViolations: { edit: ['aria-input-field-name'], readOnly: ['aria-input-field-name'] },
    blocks: [
      {
        type: 'image',
        data: {
          url: SAMPLE_IMAGE_URL,
          alt: 'A product screenshot',
          caption: 'Figure 1 — the editor',
          captionVisible: true,
        },
      },
    ],
  },
  {
    name: 'video',
    tool: 'video',
    count: 1,
    // As with image, the caption textbox is unconditional.
    knownViolations: { edit: ['aria-input-field-name'], readOnly: ['aria-input-field-name'] },
    blocks: [
      {
        type: 'video',
        data: {
          url: SAMPLE_VIDEO_URL,
          caption: 'A short clip',
          captionVisible: true,
          mimeType: 'video/mp4',
        },
      },
    ],
  },
  {
    name: 'audio',
    tool: 'audio',
    count: 1,
    blocks: [
      {
        type: 'audio',
        data: {
          url: SAMPLE_AUDIO_URL,
          fileName: 'sample.mp3',
          mimeType: 'audio/mpeg',
          title: 'Sample track',
          artist: 'Test Artist',
          duration: 90,
          // Supplied so the waveform renders from data instead of fetching and
          // decoding the file, which would make the scan race the decode.
          peaks: [0.2, 0.3, 0.35, 0.3, 0.25, 0.85, 0.84, 0.86, 0.83, 0.97, 0.95, 0.96],
        },
      },
    ],
  },
  {
    name: 'file (previewable)',
    tool: 'file',
    count: 1,
    knownViolations: { edit: ['aria-input-field-name'], readOnly: ['aria-input-field-name'] },
    blocks: [
      {
        type: 'file',
        data: {
          url: SAMPLE_TEXT_FILE_URL,
          fileName: 'release-notes.txt',
          size: 1583,
          mimeType: 'text/plain',
          caption: 'Release notes',
          captionVisible: true,
        },
      },
    ],
  },
  {
    name: 'file (download-only)',
    tool: 'file',
    count: 1,
    // Read-only drops the filename's `role="textbox"`, so only edit mode fails.
    knownViolations: { edit: ['aria-input-field-name'] },
    blocks: [
      {
        type: 'file',
        data: {
          url: SAMPLE_VIDEO_URL,
          fileName: 'archive.bin',
          size: 991017,
          mimeType: 'application/octet-stream',
        },
      },
    ],
  },
  {
    name: 'divider',
    tool: 'divider',
    count: 1,
    blocks: [
      { type: 'paragraph', data: { text: 'Above the rule.' } },
      { type: 'divider', data: {} },
      { type: 'paragraph', data: { text: 'Below the rule.' } },
    ],
  },
  {
    name: 'spacer',
    tool: 'spacer',
    count: 1,
    blocks: [
      { type: 'paragraph', data: { text: 'Above the spacer.' } },
      { type: 'spacer', data: { height: 64 } },
      { type: 'paragraph', data: { text: 'Below the spacer.' } },
    ],
  },
  {
    name: 'column_list',
    tool: 'column_list',
    count: 1,
    blocks: COLUMN_BLOCKS,
  },
  {
    name: 'column',
    tool: 'column',
    count: 2,
    blocks: COLUMN_BLOCKS,
  },
  {
    name: 'embed (link card)',
    tool: 'embed',
    count: 1,
    knownViolations: { edit: ['color-contrast'], readOnly: ['color-contrast'] },
    blocks: [
      {
        type: 'embed',
        data: {
          service: '',
          source: 'https://dashboard.example.com/widget/42',
          embed: 'https://dashboard.example.com/widget/42',
          kind: 'iframe',
          width: 580,
          height: 320,
        },
      },
    ],
  },
  {
    name: 'embed (framed)',
    tool: 'embed',
    count: 1,
    config: FRAMED_EMBED_CONFIG,
    knownViolations: { edit: ['frame-title'], readOnly: ['frame-title'] },
    blocks: [
      {
        type: 'embed',
        data: {
          service: '',
          source: FRAMED_EMBED_URL,
          embed: FRAMED_EMBED_URL,
          kind: 'iframe',
          width: 580,
          height: 320,
        },
      },
    ],
  },
  {
    name: 'bookmark',
    tool: 'bookmark',
    count: 1,
    // The description is only painted in the editable card, so read-only is clean.
    knownViolations: { edit: ['color-contrast'] },
    blocks: [
      {
        type: 'bookmark',
        data: {
          url: 'https://github.com/jackuait/blok',
          title: 'Blok — headless block-based rich text editor',
          description: 'Notion-style editor where every content entity is a block.',
          favicon: TRANSPARENT_GIF,
        },
      },
    ],
  },
];

/** Every tool at once, in one document. */
const KITCHEN_SINK_BLOCKS: OutputData['blocks'] = [
  { type: 'header', data: { text: 'Kitchen sink', level: 1 } },
  { type: 'paragraph', data: { text: SAFE_MARKS_TEXT } },
  { type: 'paragraph', data: { text: CODE_AND_LINK_TEXT } },
  { type: 'header', data: { text: 'Lists', level: 2 } },
  { type: 'list', data: { text: 'Unordered item', style: 'unordered' } },
  { type: 'list', data: { text: 'Ordered item', style: 'ordered' } },
  { type: 'list', data: { text: 'Checked task', style: 'checklist', checked: true } },
  { type: 'quote', data: { text: 'Everything is a block.', size: 'default' } },
  {
    type: 'code',
    data: { code: 'const answer = 42;\n', language: 'javascript' },
  },
  {
    type: 'table',
    data: {
      withHeadings: true,
      content: [
        ['Region', 'Owner'],
        ['EMEA', 'Ada'],
      ],
    },
  },
  ...TOGGLE_BLOCKS,
  ...CALLOUT_BLOCKS,
  ...DATABASE_BLOCKS,
  ...COLUMN_BLOCKS,
  {
    type: 'image',
    data: { url: SAMPLE_IMAGE_URL, alt: 'A product screenshot', caption: 'Figure 1', captionVisible: true },
  },
  { type: 'video', data: { url: SAMPLE_VIDEO_URL, caption: 'A short clip', mimeType: 'video/mp4' } },
  {
    type: 'audio',
    data: {
      url: SAMPLE_AUDIO_URL,
      fileName: 'sample.mp3',
      mimeType: 'audio/mpeg',
      title: 'Sample track',
      artist: 'Test Artist',
      duration: 90,
      peaks: [0.2, 0.3, 0.35, 0.3, 0.25, 0.85, 0.84, 0.86],
    },
  },
  {
    type: 'file',
    data: { url: SAMPLE_TEXT_FILE_URL, fileName: 'release-notes.txt', size: 1583, mimeType: 'text/plain' },
  },
  {
    type: 'bookmark',
    data: {
      url: 'https://github.com/jackuait/blok',
      title: 'Blok — headless block-based rich text editor',
      description: 'Notion-style editor where every content entity is a block.',
      favicon: TRANSPARENT_GIF,
    },
  },
  {
    type: 'embed',
    data: {
      service: '',
      source: 'https://dashboard.example.com/widget/42',
      embed: 'https://dashboard.example.com/widget/42',
      kind: 'iframe',
      width: 580,
      height: 320,
    },
  },
  { type: 'divider', data: {} },
  { type: 'spacer', data: { height: 64 } },
  { type: 'paragraph', data: { text: 'The end.' } },
];

/**
 * Containers inside containers: a two-column layout whose left column holds an
 * open toggle with its own children and whose right column holds a callout with
 * children plus a table.
 */
const NESTED_CONTAINER_BLOCKS: OutputData['blocks'] = [
  { id: 'n-cl', type: 'column_list', data: {}, content: ['n-c1', 'n-c2'] },

  { id: 'n-c1', type: 'column', data: {}, parent: 'n-cl', content: ['n-tog', 'n-div'] },
  {
    id: 'n-tog',
    type: 'toggle',
    data: { text: 'Nested toggle', isOpen: true },
    parent: 'n-c1',
    content: ['n-tog-h', 'n-tog-l1', 'n-tog-l2'],
  },
  { id: 'n-tog-h', type: 'header', data: { text: 'Inside the toggle', level: 3 }, parent: 'n-tog' },
  { id: 'n-tog-l1', type: 'list', data: { text: 'Toggle list item', style: 'unordered' }, parent: 'n-tog' },
  { id: 'n-tog-l2', type: 'list', data: { text: 'Toggle task', style: 'checklist', checked: true }, parent: 'n-tog' },
  { id: 'n-div', type: 'divider', data: {}, parent: 'n-c1' },

  { id: 'n-c2', type: 'column', data: {}, parent: 'n-cl', content: ['n-cal', 'n-table'] },
  {
    id: 'n-cal',
    type: 'callout',
    data: { emoji: '💡', backgroundColor: 'blue' },
    parent: 'n-c2',
    content: ['n-cal-p', 'n-cal-q'],
  },
  { id: 'n-cal-p', type: 'paragraph', data: { text: SAFE_MARKS_TEXT }, parent: 'n-cal' },
  { id: 'n-cal-q', type: 'quote', data: { text: 'A quote inside a callout inside a column.' }, parent: 'n-cal' },
  {
    id: 'n-table',
    type: 'table',
    parent: 'n-c2',
    data: {
      withHeadings: true,
      content: [
        ['Key', 'Value'],
        ['Depth', 'Three'],
      ],
    },
  },
];

test.describe('block tools — axe-core coverage', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  for (const toolCase of TOOL_CASES) {
    const scope = blocksOf(toolCase.tool);

    test(`${toolCase.name} has no critical or serious axe violations in edit mode`, async ({ page }) => {
      const known = knownFor(toolCase, 'edit');

      test.fixme(known.length > 0, `open axe findings: ${known.join(', ')}`);

      await createBlok(page, { data: { blocks: toolCase.blocks }, config: toolCase.config });

      const blocks = page.locator(scope);

      await expect(blocks).toHaveCount(toolCase.count);
      await expect(blocks.first()).toBeVisible();

      await expectNoA11yViolations(page, {
        include: scope,
        label: `${toolCase.name} — edit mode`,
      });
    });

    test(`${toolCase.name} has no critical or serious axe violations in read-only mode`, async ({ page }) => {
      const known = knownFor(toolCase, 'readOnly');

      test.fixme(known.length > 0, `open axe findings: ${known.join(', ')}`);

      await createBlok(page, {
        data: { blocks: toolCase.blocks },
        config: { ...READ_ONLY_CONFIG, ...toolCase.config },
      });

      const blocks = page.locator(scope);

      await expect(blocks).toHaveCount(toolCase.count);
      await expect(blocks.first()).toBeVisible();

      await expectNoA11yViolations(page, {
        include: scope,
        label: `${toolCase.name} — read-only mode`,
      });
    });
  }

  /**
   * Row blocks exist in the tree but the database tool paints the rows itself
   * from their data, so the row wrappers stay attached and hidden. Scanning
   * them still guards against a row ever being given visible, unlabelled DOM.
   */
  test('database-row wrappers are inert and have no critical or serious axe violations in edit mode', async ({ page }) => {
    await createBlok(page, { data: { blocks: DATABASE_BLOCKS } });

    const rows = page.locator(blocksOf('database-row'));

    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toBeAttached();
    await expect(rows.first()).toBeHidden();

    await expectNoA11yViolations(page, {
      include: blocksOf('database-row'),
      label: 'database-row — edit mode',
    });
  });

  test('database-row wrappers are inert and have no critical or serious axe violations in read-only mode', async ({ page }) => {
    await createBlok(page, { data: { blocks: DATABASE_BLOCKS }, config: READ_ONLY_CONFIG });

    const rows = page.locator(blocksOf('database-row'));

    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toBeAttached();
    await expect(rows.first()).toBeHidden();

    await expectNoA11yViolations(page, {
      include: blocksOf('database-row'),
      label: 'database-row — read-only mode',
    });
  });

  // Open findings: aria-required-parent (list), aria-input-field-name (media
  // captions), button-name (database "add view"), color-contrast (inline code,
  // links, code tokens, database pills, embed link card, bookmark description).
  test.fixme('a document containing every tool has no critical or serious axe violations in edit mode', async ({ page }) => {
    await createBlok(page, { data: { blocks: KITCHEN_SINK_BLOCKS } });

    const redactor = page.locator(REDACTOR_SELECTOR);

    await expect(redactor).toBeVisible();
    await expect(page.locator(blocksOf('paragraph')).first()).toBeVisible();
    await expect(page.locator(blocksOf('divider'))).toHaveCount(1);

    await expectNoA11yViolations(page, { include: REDACTOR_SELECTOR, label: 'kitchen sink — edit mode' });
  });

  // Same open findings as the edit-mode scan, minus button-name.
  test.fixme('a document containing every tool has no critical or serious axe violations in read-only mode', async ({ page }) => {
    await createBlok(page, { data: { blocks: KITCHEN_SINK_BLOCKS }, config: READ_ONLY_CONFIG });

    const redactor = page.locator(REDACTOR_SELECTOR);

    await expect(redactor).toBeVisible();
    await expect(page.locator(blocksOf('paragraph')).first()).toBeVisible();
    await expect(page.locator(blocksOf('divider'))).toHaveCount(1);

    await expectNoA11yViolations(page, { include: REDACTOR_SELECTOR, label: 'kitchen sink — read-only mode' });
  });

  // Open finding: aria-required-parent — the toggle's nested list items.
  test.fixme('nested containers have no critical or serious axe violations in edit mode', async ({ page }) => {
    await createBlok(page, { data: { blocks: NESTED_CONTAINER_BLOCKS } });

    await expect(page.locator(blocksOf('column'))).toHaveCount(2);
    await expect(page.locator(blocksOf('toggle')).first()).toBeVisible();
    await expect(page.locator(blocksOf('callout')).first()).toBeVisible();
    await expect(page.locator(blocksOf('table')).first()).toBeVisible();

    await expectNoA11yViolations(page, { include: REDACTOR_SELECTOR, label: 'nested containers — edit mode' });
  });

  // Open finding: aria-required-parent — the toggle's nested list items.
  test.fixme('nested containers have no critical or serious axe violations in read-only mode', async ({ page }) => {
    await createBlok(page, { data: { blocks: NESTED_CONTAINER_BLOCKS }, config: READ_ONLY_CONFIG });

    await expect(page.locator(blocksOf('column'))).toHaveCount(2);
    await expect(page.locator(blocksOf('toggle')).first()).toBeVisible();
    await expect(page.locator(blocksOf('callout')).first()).toBeVisible();
    await expect(page.locator(blocksOf('table')).first()).toBeVisible();

    await expectNoA11yViolations(page, { include: REDACTOR_SELECTOR, label: 'nested containers — read-only mode' });
  });
});
