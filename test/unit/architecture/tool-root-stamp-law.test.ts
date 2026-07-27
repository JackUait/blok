import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { API, BlockToolConstructorOptions } from '../../../types';

/**
 * TOOL ROOT STAMP LAW
 *
 * Every block tool's root element must carry `data-blok-tool="<type>"`.
 *
 * The attribute is load-bearing twice over:
 *
 * 1. It is the PAIRING KEY for view↔read-only class parity
 *    (test/unit/view/golden-harness.test.ts pairs editor and view block roots
 *    on it). A tool that renders without it is invisible to the parity gate, so
 *    its styling can drift from the view renderer with nothing to catch it.
 * 2. It is the SELECTOR HOOK the generated `view.css` keys on, and the hook the
 *    per-tool stylesheets already use (`src/styles/video.css` alone has ~175
 *    `[data-blok-tool=...]` selectors).
 *
 * `code`, `callout`, `divider` and `spacer` shipped without it; this law exists
 * so they cannot regress and so new tools inherit the requirement.
 *
 * Scope: the Phase A text tools. Extend the list as Phases B/C land.
 */

const createMockAPI = (): API =>
  ({
    styles: {
      block: 'blok-block',
      inlineToolbar: '',
      inlineToolButton: '',
      inlineToolButtonActive: '',
      settingsButton: '',
      settingsButtonActive: '',
      selected: '',
      input: '',
      loader: '',
      button: '',
    },
    i18n: {
      t: (key: string): string => key,
    },
    blocks: {
      getBlockByElement: (): undefined => undefined,
      getBlockById: (): undefined => undefined,
    },
    listeners: {
      on: (): void => undefined,
      off: (): void => undefined,
    },
    tooltip: {
      onHover: (): void => undefined,
      hide: (): void => undefined,
    },
  }) as unknown as API;

const createOptions = <T extends Record<string, unknown>>(data: T): BlockToolConstructorOptions<T> => ({
  data,
  config: {},
  api: createMockAPI(),
  readOnly: true,
  block: { id: 'law-block-id' } as never,
});

/**
 * One entry per tool: its expected `data-blok-tool` value, a loader for the
 * class, and the minimal data its `render()` needs.
 *
 * Deliberately NOT a single generic factory — these tools take different data
 * shapes, and a lowest-common-denominator stub would silently render fallback
 * DOM and make the law vacuous.
 */
const TOOLS: Array<{
  name: string;
  load: () => Promise<new (options: BlockToolConstructorOptions<never>) => { render: () => HTMLElement }>;
  data: Record<string, unknown>;
}> = [
  {
    name: 'paragraph',
    load: async () => (await import('../../../src/tools/paragraph')).Paragraph,
    data: { text: 'law' },
  },
  {
    name: 'quote',
    load: async () => (await import('../../../src/tools/quote')).Quote,
    data: { text: 'law' },
  },
  {
    name: 'code',
    load: async () => (await import('../../../src/tools/code')).CodeTool,
    data: { code: 'const a = 1;', language: 'javascript' },
  },
  {
    name: 'callout',
    load: async () => (await import('../../../src/tools/callout')).CalloutTool,
    data: { text: 'law', color: 'default' },
  },
  {
    name: 'divider',
    load: async () => (await import('../../../src/tools/divider')).DividerTool,
    data: {},
  },
  {
    name: 'spacer',
    load: async () => (await import('../../../src/tools/spacer')).SpacerTool,
    data: {},
  },
];

describe('tool root stamp law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(TOOLS)('$name stamps data-blok-tool on its root element', async ({ name, load, data }) => {
    const Tool = await load();
    const instance = new Tool(createOptions(data) as BlockToolConstructorOptions<never>);
    const root = instance.render();

    expect(
      root.getAttribute('data-blok-tool'),
      `${name}'s root element is unstamped — the parity gate and view.css cannot see it`
    ).toBe(name);
  });
});
