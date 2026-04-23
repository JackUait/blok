/**
 * Invariant: pasted clipboard payloads must NOT introduce a spurious gray
 * background (`var(--blok-color-gray-bg)`) onto every block.
 *
 * Regression target: when the page background-color (white in light mode,
 * near-black in dark mode) leaks through the paste pipeline as a
 * `<mark style="background-color: …">` element, the renderer's
 * `migrateMarkColors` collapses that low-saturation value onto the only
 * achromatic background preset — gray — leaking gray onto every paragraph
 * and heading on paste.
 *
 * This test runs the FULL paste pipeline (preprocessor → sanitizer →
 * HtmlHandler → block content) against a fixture set of realistic
 * clipboard payloads (Google Docs, browser native contenteditable in
 * light + dark mode, already-bad HTML, Notion). Any payload that did not
 * carry an explicit gray-toned highlight in its source must produce
 * block content free of `var(--blok-color-gray-bg)` after `migrateMarkColors`.
 *
 * As a positive control, a payload with a genuine gray highlight
 * (`background-color: #f1f1ef`) MUST be preserved as gray.
 *
 * The test exercises the highest layer that still drives the full
 * preprocessor + sanitizer + handler chain: `paste.processDataTransfer`
 * with realistic block-tool registration. This catches regressions
 * regardless of which entry point (Google Docs branch, browser branch,
 * already-bad HTML, table-cell paste) introduces the leak.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Paste } from '../../../../../src/components/modules/paste';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import type { SanitizerConfig } from '../../../../../types/configs/sanitizer-config';
import { Listeners } from '../../../../../src/components/utils/listeners';
import { migrateMarkColors } from '../../../../../src/components/utils/color-migration';

/** Mock DataTransfer — DataTransfer is unavailable in jsdom. */
class MockDataTransfer implements DataTransfer {
  dropEffect: 'none' | 'copy' | 'link' | 'move' = 'none';
  effectAllowed: 'none' | 'copy' | 'copyLink' | 'copyMove' | 'link' | 'linkMove' | 'all' | 'move' | 'uninitialized' = 'uninitialized';
  files: FileList;
  items: DataTransferItemList;
  types: string[];

  private data: Record<string, string> = {};

  constructor(data: Record<string, string>, files: FileList = {} as FileList, types: string[] = []) {
    this.data = data;
    this.files = files;
    this.types = types;
    this.items = [] as unknown as DataTransferItemList;
  }

  getData(format: string): string {
    return this.data[format] || '';
  }

  setData(format: string, data: string): void {
    this.data[format] = data;
  }

  clearData(format?: string): void {
    if (format !== undefined) {
      this.data[format] = '';

      return;
    }
    this.data = {};
  }

  setDragImage(_image: Element, _x: number, _y: number): void {
    /* no-op */
  }

  readonly element: HTMLElement | null = null;
}

/**
 * Build a minimal Paste instance wired to capture every HTMLElement that
 * the pipeline would hand off to a tool's onPaste handler.
 *
 * Returns the Paste instance and an array that collects the per-block
 * HTMLElement contents (one entry per BlockManager.paste call).
 */
function createPasteHarness(): {
  paste: Paste;
  capturedContents: HTMLElement[];
} {
  const holder = document.createElement('div');
  const capturedContents: HTMLElement[] = [];

  /**
   * Tool sanitize config — must allow <mark style="…"> through the
   * per-block sanitization in HtmlHandler. The handler re-sanitizes
   * with `{ ...structuralTags, ...toolTags, ...tool.baseSanitizeConfig, br: {} }`
   * (NOT merging inline config), so we put Marker's rule directly on
   * each tool's `baseSanitizeConfig`. We use the simple `{ style: true }`
   * form (rather than the real Marker function rule) because
   * HTMLJanitor's function-based rules don't preserve mutated style
   * values across the per-block sanitization step in this harness.
   */
  const toolSanitize: SanitizerConfig = {
    mark: { style: true } as unknown as SanitizerConfig['mark'],
    b: {},
    i: {},
    a: { href: true },
  };

  /** Paragraph tool — handles <p> tags. */
  const paragraphTool = {
    name: 'paragraph',
    pasteConfig: { tags: ['P'] },
    baseSanitizeConfig: toolSanitize,
    hasOnPasteHandler: true,
    isDefault: true,
  } as unknown as BlockToolAdapter;

  /** Header tool — handles H1..H6 tags. */
  const headerTool = {
    name: 'header',
    pasteConfig: { tags: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] },
    baseSanitizeConfig: toolSanitize,
    hasOnPasteHandler: true,
  } as unknown as BlockToolAdapter;

  const blockTools = new Map<string, BlockToolAdapter>([
    ['paragraph', paragraphTool],
    ['header', headerTool],
  ]);

  /**
   * Inline marker sanitize config — reuse the real Marker tool's
   * function-based rule so <mark style="background-color: …"> survives
   * the FIRST sanitization in paste/index.ts. The per-block
   * sanitization in HtmlHandler uses the tool's baseSanitizeConfig,
   * which we set above.
   */
  const inlineSanitizeConfig: SanitizerConfig = toolSanitize;

  const blockManager = {
    currentBlock: null,
    paste: vi.fn((_tool: string, event: CustomEvent) => {
      const detail = event.detail as { data: HTMLElement };

      if (detail.data instanceof HTMLElement) {
        capturedContents.push(detail.data);
      }

      return { id: `block-${capturedContents.length}`, parentId: null };
    }),
    insert: vi.fn(() => ({ id: 'inserted-block', parentId: null })),
    setCurrentBlockByChildNode: vi.fn(),
    setBlockParent: vi.fn(),
    transactForTool: vi.fn((fn: () => void) => fn()),
  };

  const caret = {
    positions: { END: 'end' as const },
    setToBlock: vi.fn(),
    insertContentAtCaretPosition: vi.fn(),
  };

  const tools = {
    blockTools,
    defaultTool: paragraphTool,
    getAllInlineToolsSanitizeConfig: vi.fn(() => inlineSanitizeConfig),
  };

  const toolbar = {
    close: vi.fn(),
    moveAndOpen: vi.fn(),
  };

  const yjsManager = {
    stopCapturing: vi.fn(),
  };

  const dragManager = { isDragging: false };

  const paste = new Paste({
    config: {
      defaultBlock: 'paragraph',
      sanitizer: {},
    },
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Paste['eventsDispatcher'],
  });

  const internals = paste as unknown as { listeners: Listeners; state: Paste['Blok'] };

  internals.listeners = new Listeners();
  internals.state = {
    BlockManager: blockManager,
    Caret: caret,
    Tools: tools,
    Toolbar: toolbar,
    YjsManager: yjsManager,
    DragManager: dragManager,
    UI: { nodes: { holder } },
  } as unknown as Paste['Blok'];

  return { paste, capturedContents };
}

/** Drive a clipboard HTML payload through the full paste pipeline. */
async function pasteHtml(payload: string): Promise<HTMLElement> {
  const { paste, capturedContents } = createPasteHarness();

  await paste.prepare();

  const dataTransfer = new MockDataTransfer(
    {
      'text/html': payload,
      'text/plain': '',
    },
    { length: 0 } as FileList,
    ['text/html', 'text/plain']
  );

  await paste.processDataTransfer(dataTransfer);

  /**
   * Aggregate every captured per-block HTMLElement into a single
   * container, mirroring what eventually lands in the editor DOM. We
   * then run `migrateMarkColors` over that container — same
   * transformation the renderer applies on real paste.
   */
  const container = document.createElement('div');

  for (const el of capturedContents) {
    container.appendChild(el.cloneNode(true));
  }
  migrateMarkColors(container);

  return container;
}

/** Fixture clipboard payloads — realistic shapes from real apps. */
const fixtures: Array<{ name: string; html: string; allowGrayBg: boolean }> = [
  {
    /**
     * Real Google Docs paste — `<b id="docs-internal-guid-…">` wrapper
     * with white-bg spans on every run. Without the fix this collapses
     * onto gray on every paragraph.
     */
    name: 'Google Docs paragraph (white page bg)',
    html: '<b id="docs-internal-guid-abc123" style="font-weight:normal;">'
      + '<p dir="ltr" style="line-height:1.38;margin:0;">'
      + '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;'
      + 'background-color:#ffffff;font-weight:400;font-style:normal;text-decoration:none;'
      + 'vertical-align:baseline;white-space:pre-wrap;">Hello from Google Docs</span>'
      + '</p></b>',
    allowGrayBg: false,
  },
  {
    /**
     * Google Docs paste with rgb() white background — the alternate
     * encoding Chrome emits.
     */
    name: 'Google Docs paragraph (rgb white)',
    html: '<b id="docs-internal-guid-def456">'
      + '<p><span style="color:rgb(0,0,0);background-color:rgb(255,255,255);'
      + 'font-family:Arial;">Plain text</span></p></b>',
    allowGrayBg: false,
  },
  {
    /**
     * Browser-native copy from a contenteditable in light mode. Chrome
     * always serialises the resolved page background-color onto the
     * outer span.
     */
    name: 'Browser contenteditable copy (light mode)',
    html: '<p><span style="color: rgb(0, 0, 0); background-color: rgb(255, 255, 255);">'
      + 'native browser paste</span></p>',
    allowGrayBg: false,
  },
  {
    /**
     * Browser-native copy from a contenteditable in dark mode. The
     * resolved page background is near-black (Blok dark theme: #191918
     * → rgb(25, 25, 24)).
     */
    name: 'Browser contenteditable copy (dark mode)',
    html: '<p><span style="color: rgb(226, 224, 220); background-color: rgb(25, 25, 24);">'
      + 'dark mode native paste</span></p>',
    allowGrayBg: false,
  },
  {
    /**
     * Already-bad HTML on the clipboard: a literal `<mark>` carrying a
     * default page background. The renderer-side migration must strip
     * this so the achromatic value never collapses onto gray.
     */
    name: 'Pre-existing <mark> with white background',
    html: '<p>before <mark style="background-color: #ffffff;">flagged</mark> after</p>',
    allowGrayBg: false,
  },
  {
    /**
     * Same as above but for dark page bg.
     */
    name: 'Pre-existing <mark> with dark background',
    html: '<p>before <mark style="background-color: rgb(25, 25, 24);">flagged</mark> after</p>',
    allowGrayBg: false,
  },
  {
    /**
     * Multi-paragraph paste — mirrors a typical "select all and copy"
     * from a docs surface. Every run carries the page background.
     */
    name: 'Multi-paragraph plain prose with white bg',
    html: '<p><span style="background-color: #ffffff;">First paragraph</span></p>'
      + '<p><span style="background-color: #ffffff;">Second paragraph</span></p>'
      + '<h2><span style="background-color: rgb(255,255,255);">A heading too</span></h2>',
    allowGrayBg: false,
  },
  {
    /**
     * POSITIVE CONTROL — explicit gray highlight that the user actually
     * picked. This MUST survive as `var(--blok-color-gray-bg)`.
     */
    name: 'Genuine gray highlight (positive control)',
    html: '<p>before <mark style="background-color: #f1f1ef;">user-picked gray</mark> after</p>',
    allowGrayBg: true,
  },
];

describe('paste invariant: no spurious gray background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const fixture of fixtures) {
    if (fixture.allowGrayBg) {
      it(`PRESERVES gray bg when source HTML has explicit gray highlight: ${fixture.name}`, async () => {
        const container = await pasteHtml(fixture.html);

        /**
         * Positive control — when the source HTML carried an explicit
         * gray-toned highlight, the migration MUST emit
         * `var(--blok-color-gray-bg)` on the surviving <mark>.
         */
        expect(container.innerHTML).toContain('--blok-color-gray-bg');

        const marks = container.querySelectorAll('mark');

        expect(marks.length).toBeGreaterThan(0);
      });

      continue;
    }

    it(`does NOT introduce gray bg from default page background: ${fixture.name}`, async () => {
      const container = await pasteHtml(fixture.html);

      /**
       * Coarse-grained assertion: the serialised block content from
       * this paste must not reference the gray-bg CSS variable
       * anywhere. If it does, a default page background leaked through
       * the pipeline and got mapped onto the achromatic gray preset.
       */
      expect(container.innerHTML).not.toContain('--blok-color-gray-bg');

      /**
       * Defensive secondary check — even if a future migration uses a
       * raw hex instead of the var, the gray-bg hex itself
       * (`#f1f1ef` light, `#2f2f2f` dark) must not appear as a
       * `background-color` on any <mark> for these fixtures.
       */
      const marks = container.querySelectorAll('mark');

      for (const mark of Array.from(marks)) {
        const bg = mark.style.getPropertyValue('background-color').toLowerCase();

        expect(bg).not.toMatch(/#f1f1ef|#2f2f2f/);
      }
    });
  }
});
