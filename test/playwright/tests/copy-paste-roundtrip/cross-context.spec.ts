/* eslint-disable playwright/expect-expect -- assertions live in the round-trip helpers */
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { CONTAINER_FIXTURES, LEAF_FIXTURES } from '../../fixtures/selection-paint-fixtures';

/**
 * Copy inside Blok, paste back into Blok, compare saves.
 */

type BlokCtor = new (config: Record<string, unknown>) => Blok;

/** Editors live on window.__cc by holder id, so several can share one page. */
type CcWindow = Window & {
  __cc: Record<string, Blok>;
  __written?: string[];
  Blok: BlokCtor;
  BlokOriginal: BlokCtor;
  BlokParagraph: unknown;
  BlokHeader: unknown;
  BlokList: unknown;
  BlokItalic: unknown;
};

type Blocks = OutputData['blocks'];
type Clip = Record<string, string>;

interface EditorOptions {
  data?: { blocks: Blocks; title?: string };
  readOnly?: boolean;
  pageTitle?: boolean;
  /** 'minimal': BlokOriginal with paragraph, header (levels 2,3), list and italic only. */
  preset?: 'default' | 'minimal';
}

const resetAll = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const w = window as unknown as CcWindow;
    const eds = Object.values(w.__cc ?? {});

    for (const ed of eds) {
      try {
        await ed.destroy?.();
      } catch {
        // already destroyed
      }
    }
    w.__cc = {};
    document.querySelectorAll('[data-cc-holder]').forEach((el) => el.remove());
  });
};

const createEditor = async (page: Page, holderId: string, options: EditorOptions = {}): Promise<void> => {
  await page.evaluate(async ({ holderId: id, options: opts }) => {
    const w = window as unknown as CcWindow;

    w.__cc ??= {};
    if (w.__cc[id]) {
      await w.__cc[id].destroy?.();
    }
    document.getElementById(id)?.remove();

    const container = document.createElement('div');

    container.id = id;
    container.setAttribute('data-cc-holder', '');
    container.setAttribute('data-blok-testid', id);
    container.style.border = '1px dotted #388AE5';
    container.style.minHeight = '80px';
    document.body.appendChild(container);

    const config: Record<string, unknown> = { holder: id };

    if (opts.data) {
      config.data = opts.data;
    }
    if (opts.readOnly) {
      config.readOnly = true;
    }
    if (opts.pageTitle) {
      config.pageTitle = true;
    }

    const Ctor = opts.preset === 'minimal' ? w.BlokOriginal : w.Blok;

    if (opts.preset === 'minimal') {
      config.tools = {
        paragraph: { class: w.BlokParagraph, inlineToolbar: true },
        header: { class: w.BlokHeader, config: { levels: [2, 3] }, inlineToolbar: true },
        list: { class: w.BlokList, inlineToolbar: true },
        italic: { class: w.BlokItalic },
      };
    }

    const ed = new Ctor(config);

    w.__cc[id] = ed;
    await ed.isReady;
  }, { holderId, options });
};

const save = async (page: Page, holderId: string): Promise<OutputData> => {
  return await page.evaluate(async (id) => {
    const w = window as unknown as CcWindow;

    return await w.__cc[id].save();
  }, holderId);
};

/** Saves until two reads agree, so a lazy paste pipeline has settled. */
const settledSave = async (page: Page, holderId: string): Promise<OutputData> => {
  // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
  await page.waitForTimeout(250);

  const reads: string[] = [];

  for (let i = 0; i < 20; i++) {
    reads.push(JSON.stringify(await save(page, holderId)));
    if (reads.length >= 2 && reads[reads.length - 1] === reads[reads.length - 2]) {
      break;
    }
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(150);
  }

  return JSON.parse(reads[reads.length - 1]) as OutputData;
};

const mod = async (page: Page): Promise<'Meta' | 'Control'> => {
  const isMac = await page.evaluate(() => navigator.platform.toLowerCase().includes('mac'));

  return isMac ? 'Meta' : 'Control';
};

/** Click the sentinel paragraph and escalate Cmd+A to select every block. */
const selectAll = async (page: Page, holderId: string, sentinel = 'TAIL-SENTINEL'): Promise<number> => {
  const m = await mod(page);

  await page.getByTestId(holderId).getByText(sentinel, { exact: true }).click();
  await page.keyboard.press(`${m}+A`);
  await page.keyboard.press(`${m}+A`);
  await page.keyboard.press(`${m}+A`);

  return await page.getByTestId(holderId).locator('[data-blok-selected="true"]').count();
};

/** Dispatch a synthetic copy/cut and capture every MIME the handler sets. */
const clipboardEvent = async (page: Page, holderId: string, type: 'copy' | 'cut'): Promise<Clip> => {
  return await page.evaluate(({ id, eventType }) => {
    return new Promise<Record<string, string>>((resolve) => {
      const store: Record<string, string> = {};
      const dt = new DataTransfer();
      const original = dt.setData.bind(dt);

      dt.setData = (format: string, data: string): void => {
        store[format] = data;
        original(format, data);
      };

      const event = new ClipboardEvent(eventType, { bubbles: true, cancelable: true, clipboardData: dt });

      if (event.clipboardData !== dt) {
        Object.defineProperty(event, 'clipboardData', { value: dt });
      }
      const target = document.activeElement && document.getElementById(id)?.contains(document.activeElement)
        ? document.activeElement
        : document.getElementById(id);

      (target ?? document.body).dispatchEvent(event);
      setTimeout(() => resolve(store), 0);
    });
  }, { id: holderId, eventType: type });
};

/** Dispatch a paste on the focused element (or the holder's first editable). */
const pasteClip = async (page: Page, holderId: string, clip: Clip): Promise<void> => {
  await page.evaluate(({ id, data }) => {
    const holder = document.getElementById(id);
    const active = document.activeElement;
    const target = active && holder?.contains(active) ? active : holder?.querySelector('[contenteditable="true"]');
    const dt = new DataTransfer();

    Object.entries(data).forEach(([type, value]) => dt.setData(type, value));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });

    if (event.clipboardData !== dt) {
      Object.defineProperty(event, 'clipboardData', { value: dt });
    }
    (target ?? holder ?? document.body).dispatchEvent(event);
  }, { id: holderId, data: clip });
};

/** Click the first editable of a fresh target editor so the paste has a caret. */
const focusFirstEditable = async (page: Page, holderId: string): Promise<void> => {
  await page.getByTestId(holderId).locator('[contenteditable="true"]').first().click();
};

const STRIP_KEYS = new Set(['lastEditedAt', 'lastEditedBy', 'createdAt']);

/** Ids become position tokens, each side on its own, so re-minted ids compare equal. */
const canonical = (blocks: Blocks): unknown[] => {
  const tokens = new Map<string, string>();
  const reg = (id: unknown): void => {
    if (typeof id === 'string' && id !== '' && !tokens.has(id)) {
      tokens.set(id, `#${tokens.size}`);
    }
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;

      reg(obj.id);
      Object.values(obj).forEach(walk);
    }
  };

  blocks.forEach((b) => reg(b.id));
  blocks.forEach((b) => walk(b.data));

  const rep = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return tokens.get(value) ?? value;
    }
    if (Array.isArray(value)) {
      return value.map(rep);
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !STRIP_KEYS.has(k))
        .map(([k, v]) => [tokens.get(k) ?? k, rep(v)]));
    }

    return value;
  };

  return blocks.map((b) => ({
    type: b.type,
    data: rep(b.data),
    tunes: rep(b.tunes ?? {}),
    parent: b.parent === undefined || b.parent === null ? null : (tokens.get(b.parent) ?? `?${b.parent}`),
    content: (b.content ?? []).map((c) => tokens.get(c) ?? `?${c}`),
  }));
};

interface Layout {
  holders: number;
  orphanHolders: number;
  /** Per saved block: the id of the nearest ancestor holder, null at root, 'none' when it has no holder. */
  ancestors: Array<[string, string | null]>;
  text: string;
}

const layoutOf = async (page: Page, holderId: string, blocks: Blocks): Promise<Layout> => {
  return await page.evaluate(({ id, ids }) => {
    const container = document.getElementById(id);

    if (!container) {
      return { holders: 0, orphanHolders: 0, ancestors: [], text: '' };
    }
    const all = Array.from(container.querySelectorAll('[data-blok-element]'));
    const known = new Set(ids);
    const ancestors = ids.map((blockId): [string, string | null] => {
      const holder = container.querySelector(`[data-blok-element][data-blok-id="${blockId}"]`);

      if (!holder) {
        return [blockId, 'none'];
      }
      const anc = holder.parentElement?.closest('[data-blok-element]');

      return [blockId, anc && container.contains(anc) ? anc.getAttribute('data-blok-id') : null];
    });

    return {
      holders: all.length,
      orphanHolders: all.filter((h) => !known.has(h.getAttribute('data-blok-id') ?? '')).length,
      ancestors,
      // Toolbars and popovers mount in the container too; read block holders only.
      text: all.filter((h) => !h.parentElement?.closest('[data-blok-element]'))
        .map((h) => (h as HTMLElement).innerText ?? '')
        .join('\n')
        .replace(/​/g, ''),
    };
  }, { id: holderId, ids: blocks.map((b) => b.id ?? '') });
};

/** Layout with ids as tokens of the saved order, so two editors compare. */
const layoutSignature = (blocks: Blocks, layout: Layout): unknown => {
  const tokens = new Map(blocks.map((b, i) => [b.id ?? '', `#${i}`]));

  return layout.ancestors.map(([id, anc]) => [tokens.get(id), anc === null || anc === 'none' ? anc : (tokens.get(anc) ?? `?${anc}`)]);
};

/** Each block's DOM ancestor must be its saved parent (or it has no holder). */
const layoutViolations = (blocks: Blocks, layout: Layout): string[] => {
  const byId = new Map(blocks.map((b) => [b.id ?? '', b]));

  return layout.ancestors.flatMap(([id, anc]) => {
    const block = byId.get(id);
    const parent = block?.parent ?? null;

    if (anc === 'none' || anc === parent) {
      return [];
    }

    return [`${block?.type}#${id}: DOM ancestor ${anc}, saved parent ${parent}`];
  });
};

const textLines = (text: string): string[] => text.split('\n').map((l) => l.trim())
  .filter((l) => l !== '');

/** Lines of the source text that the target lost or repeats. */
const textDiff = (source: string, target: string): { lost: string[]; duplicated: string[] } => {
  const count = (lines: string[]): Map<string, number> => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const s = count(textLines(source));
  const t = count(textLines(target));
  const lost: string[] = [];
  const duplicated: string[] = [];
  // A merged block keeps its text inside a longer line: a merge, not a loss.
  const occurrences = (line: string): number => target.split(line).length - 1;

  s.forEach((n, line) => {
    const got = t.get(line) ?? 0;

    if (got < n && occurrences(line) < n) {
      lost.push(line);
    }
    if (got > n) {
      duplicated.push(line);
    }
  });

  return { lost, duplicated };
};

const typeCounts = (blocks: Blocks): Record<string, number> => blocks.reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.type]: (acc[b.type] ?? 0) + 1 }), {});

const TAIL = { id: 'tail', type: 'paragraph', data: { text: 'TAIL-SENTINEL' } };

interface Variant { name: 'full' | 'html' | 'plain'; pick: (clip: Clip) => Clip }

const VARIANTS: Variant[] = [
  { name: 'full', pick: (clip) => clip },
  { name: 'html', pick: (clip) => ({ 'text/html': clip['text/html'] ?? '', 'text/plain': clip['text/plain'] ?? '' }) },
  { name: 'plain', pick: (clip) => ({ 'text/plain': clip['text/plain'] ?? '' }) },
];

interface RoundTrip {
  before: Blocks;
  after: Blocks;
  layoutEqual: boolean;
  violations: string[];
  orphanHolders: number;
  text: { lost: string[]; duplicated: string[] };
  typesBefore: Record<string, number>;
  typesAfter: Record<string, number>;
}

/** Copy every block of `blocks`, then paste one clipboard variant into a fresh editor. */
const roundTrip = async (page: Page, blocks: Blocks, variant: Variant): Promise<{ clip: Clip; selected: number; result: RoundTrip }> => {
  await createEditor(page, 'cc-a', { data: { blocks } });
  const selected = await selectAll(page, 'cc-a');
  const clip = await clipboardEvent(page, 'cc-a', 'copy');
  const before = await save(page, 'cc-a');
  const beforeLayout = await layoutOf(page, 'cc-a', before.blocks);

  await createEditor(page, 'cc-b');
  await focusFirstEditable(page, 'cc-b');
  await pasteClip(page, 'cc-b', variant.pick(clip));
  const after = await settledSave(page, 'cc-b');
  const afterLayout = await layoutOf(page, 'cc-b', after.blocks);

  return {
    clip,
    selected,
    result: {
      before: before.blocks,
      after: after.blocks,
      layoutEqual: JSON.stringify(layoutSignature(before.blocks, beforeLayout)) === JSON.stringify(layoutSignature(after.blocks, afterLayout)),
      violations: layoutViolations(after.blocks, afterLayout),
      orphanHolders: afterLayout.orphanHolders,
      text: textDiff(beforeLayout.text, afterLayout.text),
      typesBefore: typeCounts(before.blocks),
      typesAfter: typeCounts(after.blocks),
    },
  };
};

const assertRoundTrip = (label: string, variant: Variant['name'], out: { clip: Clip; selected: number; result: RoundTrip }): void => {
  const r = out.result;

  expect.soft(out.selected, `${label}: blocks selected`).toBeGreaterThan(0);
  expect.soft(Object.keys(out.clip).sort(), `${label}: clipboard flavours`).toEqual(['application/x-blok', 'text/html', 'text/plain']);
  if (variant === 'full') {
    expect.soft(canonical(r.after), `${label}: saved blocks equal`).toEqual(canonical(r.before));
    expect.soft(r.layoutEqual, `${label}: layout equal`).toBe(true);
  } else {
    expect.soft(r.typesAfter, `${label}: same block types`).toEqual(r.typesBefore);
    expect.soft(r.layoutEqual, `${label}: same nesting`).toBe(true);
  }
  expect.soft(r.violations, `${label}: DOM nesting matches saved parents`).toEqual([]);
  expect.soft(r.orphanHolders, `${label}: no orphan holders`).toBe(0);
  expect.soft(r.text.lost, `${label}: no lost text`).toEqual([]);
  expect.soft(r.text.duplicated, `${label}: no duplicated text`).toEqual([]);
};

const KNOWN_RED: Record<string, string> = {
  'leaf-toggle plain': 'cross-context-plain-toggle-tabs-columns-header-toggle: Markdown has no toggle, tab or column, so they paste back as paragraphs (format limit)',
  'container-toggle plain': 'cross-context-plain-toggle-tabs-columns-header-toggle: Markdown has no toggle, tab or column, so they paste back as paragraphs (format limit)',
  'container-header plain': 'cross-context-plain-toggle-tabs-columns-header-toggle: Markdown has no toggle, tab or column, so they paste back as paragraphs (format limit)',
  'nested-toggle-in-callout plain': 'cross-context-plain-callout-merges-children: a callout exports as one blockquote; awaits a decision',
  'collapsed-toggle plain': 'cross-context-plain-toggle-tabs-columns-header-toggle: Markdown has no toggle, tab or column, so they paste back as paragraphs (format limit)',
  'leaf-tabs plain': 'cross-context-plain-toggle-tabs-columns-header-toggle: Markdown has no toggle, tab or column, so they paste back as paragraphs (format limit)',
  'container-tab plain': 'cross-context-plain-toggle-tabs-columns-header-toggle: Markdown has no toggle, tab or column, so they paste back as paragraphs (format limit)',
  'container-column plain': 'cross-context-plain-toggle-tabs-columns-header-toggle: Markdown has no toggle, tab or column, so they paste back as paragraphs (format limit)',
  'leaf-callout plain': 'cross-context-plain-callout-merges-children: a callout exports as one blockquote; awaits a decision',
  'container-callout plain': 'cross-context-plain-callout-merges-children: a callout exports as one blockquote; awaits a decision',
  'leaf-tabs html': 'containers-html-tabs-loses-titles: html has no tabs, so they paste back as a bold title and paragraphs (format limit)',
  'container-tab html': 'containers-html-tabs-loses-titles: html has no tabs, so they paste back as a bold title and paragraphs (format limit)',
  'container-column html': 'cross-context-html-columns-flattened: html has no column layout (format limit)',
  'leaf-database html': 'database-whole-degraded-html: html carries the title and row titles only',
  'leaf-database plain': 'cross-context-plain-database: Markdown drops row properties; awaits a decision',
  'leaf-spacer html': 'atomic-html-spacer-toc-ui-leak: a spacer writes nothing to html by design',
  'leaf-spacer plain': 'atomic-plain-spacer-toc: a spacer has no Markdown form by design',
  'leaf-table_of_contents html': 'atomic-html-spacer-toc-ui-leak: a table of contents writes nothing to html by design',
  'leaf-table_of_contents plain': 'atomic-plain-spacer-toc: a table of contents has no Markdown form by design',
  'leaf-image html': 'atomic-html-image: the caption pastes back as its own paragraph',
  'leaf-image plain': 'atomic-plain-image-caption: a Markdown image has no caption',
  'leaf-file html': 'cross-context-html-file-lost: a data: url cannot travel as a link',
  'leaf-file plain': 'cross-context-plain-media-url-lost: a data: url is refused as a Markdown link on purpose',
  'leaf-audio html': 'cross-context-html-audio-video-lost: a data: url cannot travel as a link',
  'leaf-audio plain': 'cross-context-plain-media-url-lost: a data: url is refused as a Markdown link on purpose',
  'leaf-video html': 'cross-context-html-audio-video-lost: a data: url cannot travel as a link',
  'leaf-video plain': 'cross-context-plain-media-url-lost: a data: url is refused as a Markdown link on purpose',
  'leaf-embed html': 'cross-context-html-embed-dropped: an embed copies as a link and pastes back as a linked paragraph',
  'leaf-embed plain': 'cross-context-plain-embed-bookmark-spacer-toc: an embed pastes back as a linked paragraph (format limit)',
  'leaf-bookmark html': 'cross-context-html-bookmark-junk: a bookmark copies as a link and pastes back as a linked paragraph',
  'leaf-bookmark plain': 'cross-context-plain-embed-bookmark-spacer-toc: a bookmark pastes back as a linked paragraph (format limit)',
  'page-block full': 'cross-context-full-page-block: by design a page block pastes as a page reference',
  'page-block html': 'atomic-html-page-and-page-link: a page block pastes back as a link (format limit)',
  'page-block plain': 'atomic-html-page-and-page-link: a page block pastes back as a link (format limit)',
  'nested-lists html': 'degraded-list-paste-flat-depth: a nested item pasted from html is saved under its parent item, but its holder stays at the root (possible regression from eb4f6f0b, not bisected)',
  'nested-lists plain': 'degraded-list-paste-flat-depth: a nested item pasted from plain text is saved under its parent item, but its holder stays at the root (possible regression from eb4f6f0b, not bisected)',
};

const MATRIX: Array<{ name: string; blocks: Blocks }> = [
  ...LEAF_FIXTURES.map((f) => ({ name: `leaf-${f.tool}`, blocks: [...f.blocks(null, 'f'), TAIL] })),
  ...CONTAINER_FIXTURES.map((f) => ({
    name: `container-${f.tool}`,
    blocks: [
      ...f.blocks('f', ['f-child']),
      { id: 'f-child', type: 'paragraph', data: { text: 'CHILD-SENTINEL' }, parent: f.childParentId('f') },
      TAIL,
    ],
  })),
  {
    name: 'rich-paragraph',
    blocks: [
      {
        id: 'rich',
        type: 'paragraph',
        data: { text: 'Rich <b>bold</b> <i>italic</i> <a href="https://example.com/x">link</a> <s>strike</s> <u>under</u> <code>code</code> <mark style="color: rgb(212, 76, 71); background-color: transparent;">red</mark>' },
      },
      TAIL,
    ],
  },
  {
    name: 'nested-lists',
    blocks: [
      { id: 'l1', type: 'list', data: { text: 'Bullet one', style: 'unordered', depth: 0 } },
      { id: 'l2', type: 'list', data: { text: 'Bullet nested', style: 'unordered', depth: 1 } },
      { id: 'l3', type: 'list', data: { text: 'Number one', style: 'ordered', depth: 0 } },
      { id: 'l4', type: 'list', data: { text: 'Number nested', style: 'ordered', depth: 1 } },
      { id: 'l5', type: 'list', data: { text: 'Todo done', style: 'checklist', checked: true, depth: 0 } },
      { id: 'l6', type: 'list', data: { text: 'Todo open', style: 'checklist', checked: false, depth: 1 } },
      TAIL,
    ],
  },
  {
    name: 'headers-levels',
    blocks: [
      { id: 'h1', type: 'header', data: { text: 'Heading one', level: 1 } },
      { id: 'h3', type: 'header', data: { text: 'Heading three', level: 3 } },
      TAIL,
    ],
  },
  {
    name: 'page-block',
    blocks: [{ id: 'pg', type: 'page', data: { pageId: 'page-xyz' } }, TAIL],
  },
  {
    name: 'nested-toggle-in-callout',
    blocks: [
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['tg'] },
      { id: 'tg', type: 'toggle', data: { text: 'Inner toggle', isOpen: true }, parent: 'co', content: ['tp'] },
      { id: 'tp', type: 'paragraph', data: { text: 'Deep child' }, parent: 'tg' },
      TAIL,
    ],
  },
  {
    name: 'collapsed-toggle',
    blocks: [
      { id: 'ct', type: 'toggle', data: { text: 'Closed toggle', isOpen: false }, content: ['cp'] },
      { id: 'cp', type: 'paragraph', data: { text: 'Hidden child' }, parent: 'ct' },
      TAIL,
    ],
  },
];

test.describe('cross-context round trips', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof (window as unknown as CcWindow).Blok === 'function');
    await resetAll(page);
  });

  for (const entry of MATRIX) {
    for (const variant of VARIANTS) {
      const label = `${entry.name} ${variant.name}`;

      test(`matrix: ${label}`, async ({ page }) => {
        test.fixme(label in KNOWN_RED, KNOWN_RED[label]);
        const out = await roundTrip(page, entry.blocks, variant);

        assertRoundTrip(label, variant.name, out);
      });
    }
  }

  // A lone media or URL block: its text/plain matches a tool's paste pattern.
  for (const single of [
    { name: 'bookmark', fixture: 'bookmark' },
    { name: 'embed', fixture: 'embed' },
    { name: 'image', fixture: 'image' },
    { name: 'video', fixture: 'video' },
    { name: 'audio', fixture: 'audio' },
    { name: 'file', fixture: 'file' },
  ]) {
    test(`single: ${single.name} alone keeps its data on a full paste`, async ({ page }) => {
      const fixture = LEAF_FIXTURES.find((f) => f.tool === single.fixture);

      if (!fixture) {
        throw new Error(`no fixture ${single.fixture}`);
      }
      const blocks = fixture.blocks(null, 'one');

      await createEditor(page, 'cc-a', { data: { blocks: [...blocks, TAIL] } });
      await page.evaluate(() => (window as unknown as CcWindow).__cc['cc-a'].blocks.scrollToBlock?.('one', { select: true }));
      const selected = await page.getByTestId('cc-a').locator('[data-blok-selected="true"]').count();
      const clip = await clipboardEvent(page, 'cc-a', 'copy');
      const before = (await save(page, 'cc-a')).blocks.filter((b) => b.id !== 'tail');

      await createEditor(page, 'cc-b');
      await focusFirstEditable(page, 'cc-b');
      await pasteClip(page, 'cc-b', clip);
      const after = (await settledSave(page, 'cc-b')).blocks;

      expect.soft(selected).toBe(1);
      expect(canonical(after)).toEqual(canonical(before));
    });
  }

  test('single: a paragraph holding only a URL keeps its data on a full paste', async ({ page }) => {
    const blocks = [{ id: 'url', type: 'paragraph', data: { text: '<a href="https://example.com/page">https://example.com/page</a>' } }];

    await createEditor(page, 'cc-a', { data: { blocks: [...blocks, TAIL] } });
    await page.evaluate(() => (window as unknown as CcWindow).__cc['cc-a'].blocks.scrollToBlock?.('url', { select: true }));
    const clip = await clipboardEvent(page, 'cc-a', 'copy');
    const before = (await save(page, 'cc-a')).blocks.filter((b) => b.id !== 'tail');

    await createEditor(page, 'cc-b');
    await focusFirstEditable(page, 'cc-b');
    await pasteClip(page, 'cc-b', clip);
    const after = (await settledSave(page, 'cc-b')).blocks;

    expect(canonical(after)).toEqual(canonical(before));
  });

  test('stale preservedData: typed text then immediate copy carries the new text', async ({ page }) => {
    await createEditor(page, 'cc-a', { data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Start' } }, TAIL] } });
    await page.getByTestId('cc-a').getByText('Start', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed now');
    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'copy');

    expect(clip['application/x-blok'] ?? '').toContain('typed now');
    expect(clip['text/html'] ?? '').toContain('typed now');
  });

  test('two instances: full copy from A pastes into B with the same blocks', async ({ page }) => {
    test.fixme(true, 'cross-context-two-instances-full: the source saves its toggle in the legacy toggleList shape, the paste saves a toggle with a child block');
    const blocks: Blocks = [
      { id: 'h', type: 'header', data: { text: 'Heading one', level: 1 } },
      { id: 't', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Toggle child' }, parent: 't' },
      { id: 'tb', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] } },
      TAIL,
    ];

    await createEditor(page, 'cc-a', { data: { blocks } });
    await createEditor(page, 'cc-b');
    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'copy');
    const before = await save(page, 'cc-a');

    await focusFirstEditable(page, 'cc-b');

    await pasteClip(page, 'cc-b', clip);
    const after = await settledSave(page, 'cc-b');
    const aAfter = await save(page, 'cc-a');
    const layout = await layoutOf(page, 'cc-b', after.blocks);

    expect.soft(canonical(aAfter.blocks), 'A untouched').toEqual(canonical(before.blocks));
    expect.soft(layoutViolations(after.blocks, layout)).toEqual([]);
    expect(canonical(after.blocks)).toEqual(canonical(before.blocks));
  });

  test('two instances: A selection survives a click into B, and a cut in B must not cut A', async ({ page }) => {
    const blocks: Blocks = [{ id: 'a1', type: 'paragraph', data: { text: 'A one' } }, TAIL];

    await createEditor(page, 'cc-a', { data: { blocks } });
    await createEditor(page, 'cc-b', { data: { blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'B text' } }] } });
    await selectAll(page, 'cc-a');
    await page.getByTestId('cc-b').getByText('B text', { exact: true }).click();
    const aSelectedAfterClickB = await page.getByTestId('cc-a').locator('[data-blok-selected="true"]').count();
    // A native text selection inside B, then cut: only B's text should go.
    await page.evaluate(() => {
      const el = document.querySelector('#cc-b [contenteditable="true"]');
      const range = document.createRange();

      range.selectNodeContents(el as Node);
      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await clipboardEvent(page, 'cc-b', 'cut');
    const aAfter = await settledSave(page, 'cc-a');

    expect.soft(aSelectedAfterClickB, 'A selection cleared by clicking B').toBe(0);
    expect(aAfter.blocks.map((b) => b.id)).toEqual(['a1', 'tail']);
  });

  test('two instances: B lacks toggle/callout/bold and has header levels 2,3 only; B->A round trip keeps the data', async ({ page }) => {
    test.fixme(true, 'cross-context-missing-tool-roundtrip-back: B allows header levels 2 and 3, so level 1 comes back as 3; awaits a decision');
    test.setTimeout(60_000);
    const blocks: Blocks = [
      { id: 'h1', type: 'header', data: { text: 'Heading one', level: 1 } },
      { id: 't', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Toggle child' }, parent: 't' },
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['cc'] },
      { id: 'cc', type: 'paragraph', data: { text: 'Callout child' }, parent: 'co' },
      { id: 'b', type: 'paragraph', data: { text: 'Some <b>bold</b> and <i>italic</i>' } },
      TAIL,
    ];

    await createEditor(page, 'cc-a', { data: { blocks } });
    await createEditor(page, 'cc-b', { preset: 'minimal' });
    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'copy');
    const before = await save(page, 'cc-a');

    await focusFirstEditable(page, 'cc-b');
    await pasteClip(page, 'cc-b', clip);
    const inB = await settledSave(page, 'cc-b');

    // Back from B into a fresh default editor.
    await selectAll(page, 'cc-b');
    const clipB = await clipboardEvent(page, 'cc-b', 'copy');

    await createEditor(page, 'cc-c');
    await focusFirstEditable(page, 'cc-c');
    await pasteClip(page, 'cc-c', clipB);
    const back = await settledSave(page, 'cc-c');

    expect.soft(inB.blocks.length, 'B keeps every block (stubs for missing tools)').toBe(before.blocks.length);
    expect(canonical(back.blocks), 'A -> B -> A keeps every block and field').toEqual(canonical(before.blocks));
  });

  test('read-only: copy a native selection across blocks and paste into an editable editor', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const blocks: Blocks = [
      { id: 'h', type: 'header', data: { text: 'RO heading', level: 2 } },
      { id: 'p', type: 'paragraph', data: { text: 'RO <b>bold</b> para' } },
      { id: 'l1', type: 'list', data: { text: 'RO item', style: 'unordered', depth: 0 } },
      { id: 't', type: 'toggle', data: { text: 'RO toggle', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'RO child' }, parent: 't' },
      { id: 'last', type: 'paragraph', data: { text: 'RO-END' } },
    ];

    await createEditor(page, 'cc-a', { data: { blocks }, readOnly: true });
    await page.evaluate(() => {
      const container = document.getElementById('cc-a') as HTMLElement;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.textContent ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      const nodes: Node[] = [];

      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n);
      }
      const range = document.createRange();

      range.setStart(nodes[0], 0);
      range.setEnd(nodes[nodes.length - 1], (nodes[nodes.length - 1].textContent ?? '').length);
      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const synthetic = await clipboardEvent(page, 'cc-a', 'copy');
    // Native copy: the browser's own serializer, read back from the system clipboard.
    const native = await page.evaluate(async () => {
      const ok = document.execCommand('copy');
      const out: Record<string, string> = {};

      try {
        const items = await navigator.clipboard.read();

        for (const item of items) {
          // eslint-disable-next-line max-depth -- in-page DOM walk
          for (const type of item.types) {
            out[type] = await (await item.getType(type)).text();
          }
        }
      } catch (error) {
        out.error = String(error);
      }

      return { ok, out };
    });
    const clip = Object.keys(synthetic).length > 0 ? synthetic : native.out;

    await createEditor(page, 'cc-b');
    await focusFirstEditable(page, 'cc-b');
    await pasteClip(page, 'cc-b', clip);
    const after = await settledSave(page, 'cc-b');
    const layout = await layoutOf(page, 'cc-b', after.blocks);

    expect.soft(layoutViolations(after.blocks, layout)).toEqual([]);
    expect(after.blocks.map((b) => b.type)).toEqual(['header', 'paragraph', 'list', 'toggle', 'paragraph', 'paragraph']);
  });

  test('read-only: Cmd+A selects blocks and copy carries application/x-blok', async ({ page }) => {
    const blocks: Blocks = [{ id: 'p', type: 'paragraph', data: { text: 'RO para' } }, TAIL];

    await createEditor(page, 'cc-a', { data: { blocks }, readOnly: true });
    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'copy');

    expect(Object.keys(clip)).toContain('text/html');
  });

  test('read-only: a real Cmd+A after a click selects the blocks', async ({ page }) => {
    const blocks: Blocks = [{ id: 'p', type: 'paragraph', data: { text: 'RO para' } }, TAIL];

    await createEditor(page, 'cc-a', { data: { blocks }, readOnly: true });
    const m = await mod(page);

    await page.getByTestId('cc-a').getByText('TAIL-SENTINEL', { exact: true }).click();
    await page.keyboard.press(`${m}+A`);

    await expect(page.getByTestId('cc-a').locator('[data-blok-selected="true"]')).not.toHaveCount(0);
  });

  test('page title + body: a native selection from the title into the body copies both', async ({ page }) => {
    test.fixme(true, 'cross-context-title-body-native: Blok leaves a selection from the title into the body to the browser copy');
    await createEditor(page, 'cc-a', { pageTitle: true, data: { title: 'TITLE-SENTINEL', blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Body one' } }, TAIL] } });
    await page.evaluate(() => {
      const title = document.querySelector('#cc-a [data-blok-testid="page-header-title"]') as HTMLElement;
      const last = Array.from(document.querySelectorAll('#cc-a [contenteditable="true"]')).pop() as HTMLElement;
      const range = document.createRange();

      range.setStart(title.firstChild ?? title, 0);
      range.setEnd(last.firstChild ?? last, (last.textContent ?? '').length);
      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const synthetic = await clipboardEvent(page, 'cc-a', 'copy');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const native = await page.evaluate(async () => {
      const ok = document.execCommand('copy');
      const out: Record<string, string> = {};

      try {
        for (const item of await navigator.clipboard.read()) {
          // eslint-disable-next-line max-depth -- in-page DOM walk
          for (const type of item.types) {
            out[type] = await (await item.getType(type)).text();
          }
        }
      } catch (error) {
        out.error = String(error);
      }

      return { ok, out };
    });
    const clip = Object.keys(synthetic).length > 0 ? synthetic : native.out;

    await createEditor(page, 'cc-b');
    await focusFirstEditable(page, 'cc-b');
    await pasteClip(page, 'cc-b', clip);
    const after = await settledSave(page, 'cc-b');

    expect.soft(Object.keys(synthetic).length, 'Blok wrote the clipboard').toBeGreaterThan(0);
    expect(JSON.stringify(after.blocks)).toMatch(/TITLE-SENTINEL/);
    expect(JSON.stringify(after.blocks)).toContain('Body one');
  });

  test('page title: pasting a Blok block clipboard into the title', async ({ page }) => {
    await createEditor(page, 'cc-a', { data: { blocks: [{ id: 'h', type: 'header', data: { text: 'Head', level: 2 } }, { id: 'p', type: 'paragraph', data: { text: 'Para' } }, TAIL] } });
    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'copy');

    await createEditor(page, 'cc-b', { pageTitle: true, data: { title: 'T', blocks: [{ id: 'q', type: 'paragraph', data: { text: 'Body' } }] } });
    await page.getByTestId('cc-b').locator('[data-blok-testid="page-header-title"]').click();
    await page.keyboard.press('End');
    await pasteClip(page, 'cc-b', clip);
    const after = await settledSave(page, 'cc-b');

    expect.soft((after as unknown as { title?: string }).title).toBe('THead Para TAIL-SENTINEL');
    expect(after.blocks.map((b) => b.id)).toEqual(['q']);
  });

  test('copy-link tune: the copied URL pasted back into the same editor', async ({ page }) => {
    await createEditor(page, 'cc-a', { data: { blocks: [{ id: 'target', type: 'paragraph', data: { text: 'Link me' } }, { id: 'dest', type: 'paragraph', data: { text: '' } }, TAIL] } });
    await page.evaluate(() => {
      const w = window as unknown as CcWindow;

      const written: string[] = [];

      w.__written = written;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (t: string) => {
          written.push(t);
        } },
      });
    });
    await page.evaluate(() => (window as unknown as CcWindow).__cc['cc-a'].blocks.scrollToBlock?.('target', { select: true }));
    await page.keyboard.press('Control+Meta+L');
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(200);
    const written = await page.evaluate(() => (window as unknown as CcWindow).__written as string[]);
    const url = written[0] ?? '';

    await page.getByTestId('cc-a').locator('[data-blok-id="dest"] [contenteditable="true"]').click();
    await pasteClip(page, 'cc-a', { 'text/plain': url });
    const after = await settledSave(page, 'cc-a');

    expect.soft(url).toMatch(/#target$/);
    // A link to a block on this page should come back as a link, not a fetched card or embed.
    const dest = after.blocks[1];

    expect(dest?.type).toBe('paragraph');
  });

  test('copy as Markdown (Cmd+Shift+C): pasted back into a fresh editor', async ({ page }) => {
    test.fixme(true, 'cross-context-copy-as-markdown: Markdown has no toggle, and a flat depth-1 list item now pastes as a child of the item above');
    const blocks: Blocks = [
      { id: 'h', type: 'header', data: { text: 'MD heading', level: 2 } },
      { id: 'p', type: 'paragraph', data: { text: 'MD <b>bold</b> <i>it</i>' } },
      { id: 'l1', type: 'list', data: { text: 'MD item', style: 'unordered', depth: 0 } },
      { id: 'l2', type: 'list', data: { text: 'MD sub', style: 'unordered', depth: 1 } },
      { id: 'c', type: 'list', data: { text: 'MD todo', style: 'checklist', checked: true, depth: 0 } },
      { id: 'q', type: 'quote', data: { text: 'MD quote', size: 'default' } },
      { id: 'cd', type: 'code', data: { code: 'let x = 1;', language: 'javascript' } },
      { id: 't', type: 'toggle', data: { text: 'MD toggle', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'MD child' }, parent: 't' },
      TAIL,
    ];

    await createEditor(page, 'cc-a', { data: { blocks } });
    await page.evaluate(() => {
      const w = window as unknown as CcWindow;

      const written: string[] = [];

      w.__written = written;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (t: string) => {
          written.push(t);
        } },
      });
    });
    await selectAll(page, 'cc-a');
    const m = await mod(page);

    await page.keyboard.press(`${m}+Shift+C`);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(200);
    const written = await page.evaluate(() => (window as unknown as CcWindow).__written as string[]);
    const before = await save(page, 'cc-a');

    await createEditor(page, 'cc-b');
    await focusFirstEditable(page, 'cc-b');
    await pasteClip(page, 'cc-b', { 'text/plain': written[0] ?? '' });
    const after = await settledSave(page, 'cc-b');

    expect(canonical(after.blocks)).toEqual(canonical(before.blocks));
  });

  test('cut, undo, then paste: original restored and a second copy pasted with fresh ids', async ({ page }) => {
    const blocks: Blocks = [
      { id: 'p1', type: 'paragraph', data: { text: 'Cut one' } },
      { id: 't', type: 'toggle', data: { text: 'Cut toggle', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Cut child' }, parent: 't' },
      { id: 'pg', type: 'page', data: { pageId: 'page-cut' } },
      TAIL,
    ];

    await createEditor(page, 'cc-a', { data: { blocks } });
    const before = await save(page, 'cc-a');

    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'cut');
    await settledSave(page, 'cc-a');
    const m = await mod(page);

    await page.keyboard.press(`${m}+Z`);
    const afterUndo = await settledSave(page, 'cc-a');

    await page.evaluate(async () => {
      const ed = (window as unknown as CcWindow).__cc['cc-a'];

      ed.blocks.insert('paragraph', { text: '' }, {}, ed.blocks.getBlocksCount(), true);
      ed.caret.setToLastBlock('end');
    });
    await pasteClip(page, 'cc-a', clip);
    const afterPaste = await settledSave(page, 'cc-a');
    const ids = afterPaste.blocks.map((b) => b.id);

    expect.soft(canonical(afterUndo.blocks), 'undo restores the cut blocks').toEqual(canonical(before.blocks));
    expect.soft(new Set(ids).size, 'ids unique').toBe(ids.length);
    const roots = afterPaste.blocks.filter((b) => !b.parent);

    expect(roots.map((b) => b.type)).toEqual(['paragraph', 'toggle', 'page', 'paragraph', 'paragraph', 'toggle', 'page', 'paragraph']);
  });

  test('paste the same clipboard twice into the source editor: ids unique, every copy intact, source untouched', async ({ page }) => {
    const blocks: Blocks = [
      { id: 't', type: 'toggle', data: { text: 'Twice toggle', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Twice child' }, parent: 't' },
      { id: 'tb', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [['A', 'B'], ['C', 'D']] } },
      ...(LEAF_FIXTURES.find((f) => f.tool === 'database')?.blocks(null, 'db') ?? []),
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['cc'] },
      { id: 'cc', type: 'paragraph', data: { text: 'Twice callout child' }, parent: 'co' },
      { id: 'l1', type: 'list', data: { text: 'Twice item', style: 'unordered', depth: 0 } },
      { id: 'l2', type: 'list', data: { text: 'Twice sub', style: 'unordered', depth: 1 } },
      TAIL,
    ];

    await createEditor(page, 'cc-a', { data: { blocks } });
    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'copy');
    const before = await save(page, 'cc-a');

    for (let i = 0; i < 2; i++) {
      await page.evaluate(async () => {
        const ed = (window as unknown as CcWindow).__cc['cc-a'];

        ed.blocks.insert('paragraph', { text: '' }, {}, ed.blocks.getBlocksCount(), true);
        ed.caret.setToLastBlock('end');
      });
      await pasteClip(page, 'cc-a', clip);
      await settledSave(page, 'cc-a');
    }
    const after = await settledSave(page, 'cc-a');
    const layout = await layoutOf(page, 'cc-a', after.blocks);
    const ids = after.blocks.map((b) => b.id ?? '');
    const byId = new Map(after.blocks.map((b) => [b.id ?? '', b]));
    const rootOf = (id: string): string => {
      const b = byId.get(id);

      return b?.parent ? rootOf(b.parent) : id;
    };
    const roots = after.blocks.filter((b) => !b.parent).map((b) => b.id ?? '');
    const srcRoots = before.blocks.filter((b) => !b.parent).length;
    const part = (from: number, to: number): Blocks => {
      const set = new Set(roots.slice(from, to));

      return after.blocks.filter((b) => set.has(rootOf(b.id ?? '')));
    };
    const linkErrors = after.blocks.flatMap((b) => [
      ...(b.content ?? []).filter((c) => byId.get(c)?.parent !== b.id).map((c) => `${b.id} lists ${c} which is not its child`),
      ...(b.parent && !(byId.get(b.parent)?.content ?? []).includes(b.id ?? '') ? [`${b.id} parent ${b.parent} does not list it`] : []),
    ]);
    const parts = [part(0, srcRoots), part(srcRoots, srcRoots * 2), part(srcRoots * 2, srcRoots * 3)];

    expect.soft(new Set(ids).size, 'ids unique').toBe(ids.length);
    expect.soft(linkErrors).toEqual([]);
    expect.soft(layoutViolations(after.blocks, layout)).toEqual([]);
    expect.soft(roots.length).toBe(srcRoots * 3);
    expect.soft(canonical(parts[0]), 'source untouched').toEqual(canonical(before.blocks));
    expect.soft(canonical(parts[1]), 'first paste intact').toEqual(canonical(before.blocks));
    expect(canonical(parts[2]), 'second paste intact').toEqual(canonical(before.blocks));
  });

  for (const bare of [
    { name: 'codepen-url', text: 'https://codepen.io/team/pen/abc123' },
    { name: 'png-url', text: 'https://example.com/picture.png' },
    { name: 'dashes', text: '---' },
  ]) {
    test(`single: a paragraph holding bare ${bare.name} stays a paragraph on a full paste`, async ({ page }) => {
      await createEditor(page, 'cc-a', { data: { blocks: [{ id: 'one', type: 'paragraph', data: { text: bare.text } }, TAIL] } });
      await page.evaluate(() => (window as unknown as CcWindow).__cc['cc-a'].blocks.scrollToBlock?.('one', { select: true }));
      const clip = await clipboardEvent(page, 'cc-a', 'copy');
      const before = (await save(page, 'cc-a')).blocks.filter((b) => b.id !== 'tail');

      await createEditor(page, 'cc-b');
      await focusFirstEditable(page, 'cc-b');
      await pasteClip(page, 'cc-b', clip);
      const after = (await settledSave(page, 'cc-b')).blocks;

      expect(canonical(after)).toEqual(canonical(before));
    });
  }

  test('missing tool: paste into an editor without toggle, then a bold paragraph into an editor without bold', async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];

    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') {
        errors.push(`${m.type()}: ${m.text()}`);
      }
    });
    await createEditor(page, 'cc-a', { data: { blocks: [
      { id: 'p1', type: 'paragraph', data: { text: 'Before toggle' } },
      { id: 't', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Toggle child' }, parent: 't' },
      { id: 'p2', type: 'paragraph', data: { text: 'After toggle' } },
      TAIL,
    ] } });
    await selectAll(page, 'cc-a');
    const clip = await clipboardEvent(page, 'cc-a', 'copy');

    await createEditor(page, 'cc-b', { preset: 'minimal' });
    await focusFirstEditable(page, 'cc-b');
    await pasteClip(page, 'cc-b', clip);
    const inB = await settledSave(page, 'cc-b');

    await createEditor(page, 'cc-a', { data: { blocks: [{ id: 'b', type: 'paragraph', data: { text: 'Some <b>bold</b> and <i>italic</i>' } }, TAIL] } });
    await selectAll(page, 'cc-a');
    const clipBold = await clipboardEvent(page, 'cc-a', 'copy');

    await createEditor(page, 'cc-c', { preset: 'minimal' });
    await focusFirstEditable(page, 'cc-c');
    await pasteClip(page, 'cc-c', clipBold);
    const inC = await settledSave(page, 'cc-c');

    expect.soft(inC.blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(inB.blocks.length).toBeGreaterThanOrEqual(5);
  });

  test('read-only: is the open toggle child visible', async ({ page }) => {
    test.fixme(true, 'cross-context-readonly-copy: a read-only toggle saved open renders closed');
    await createEditor(page, 'cc-a', { readOnly: true, data: { blocks: [
      { id: 't', type: 'toggle', data: { text: 'RO toggle', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'RO child' }, parent: 't' },
    ] } });
    const visible = page.getByTestId('cc-a').getByText('RO child', { exact: true });

    await expect(visible).toBeVisible();
  });

  test('real keyboard: Cmd+C in A and Cmd+V in B through the browser clipboard', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const blocks: Blocks = [
      { id: 't', type: 'toggle', data: { text: 'Kb toggle', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Kb child' }, parent: 't' },
      { id: 'h', type: 'header', data: { text: 'Kb heading', level: 2 } },
      TAIL,
    ];

    await createEditor(page, 'cc-a', { data: { blocks } });
    await createEditor(page, 'cc-b');
    const before = await save(page, 'cc-a');
    const m = await mod(page);

    await selectAll(page, 'cc-a');
    await page.keyboard.press(`${m}+C`);
    await focusFirstEditable(page, 'cc-b');
    await page.keyboard.press(`${m}+V`);
    const after = await settledSave(page, 'cc-b');

    expect(canonical(after.blocks)).toEqual(canonical(before.blocks));
  });
});
