/**
 * Undo/redo audit wave 4 (W4N): framework adapters, and targets that are
 * hidden (inside a collapsed toggle) or nested several levels deep.
 *
 * Expected everywhere: one undo reverts one gesture, redo restores the exact
 * post-gesture state, in save() AND on screen, and the host's change callbacks
 * see the state the editor shows.
 */
import type { Locator, Page } from '@playwright/test';
import { test as isolatedTest } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const MOVE_DOWN = process.platform === 'darwin' ? 'Meta+Shift+ArrowDown' : 'Control+Shift+ArrowDown';
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;
// onSave rides the trailing edge of a 400ms change window.
const SAVE_SETTLE = 1500;

type SavedBlock = OutputData['blocks'][number];
type DomTree = Array<[string, string | null]>;

interface Harness {
  renders: number;
  saves: number;
  ready: boolean;
  last?: OutputData;
}

declare global {
  interface Window {
    blokInstance?: Blok;
    __w4n?: Harness;
    __app?: { setRo: (v: boolean) => void; remount: () => void; rerender: () => void };
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async ({ holder, initial }) => {
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
};

const save = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  // lastEdited* is authorship metadata, not document state.
  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

const tree = async (page: Page): Promise<Array<[string, string | null]>> =>
  (await save(page)).map(b => [b.id ?? '', b.parent ?? null]);

const gap = async (page: Page, ms = CAPTURE_GAP): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

/** Each rendered block and the id of the block holder that encloses it in the DOM. */
const domTree = async (page: Page): Promise<DomTree> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"]')).map(el => [
    el.getAttribute('data-blok-id') ?? '',
    el.parentElement?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id') ?? null,
  ] as [string, string | null]));

const holder = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"]`);

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await gap(page, 500);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await gap(page, 500);
};

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const typeAtEnd = async (page: Page, id: string, value: string): Promise<void> => {
  await editable(page, id).click();
  await page.keyboard.press('End');
  await page.keyboard.type(value);
};

const selectAndDelete = async (page: Page, id: string): Promise<void> => {
  await editable(page, id).click();
  await page.evaluate((i) => {
    const bs = (window.blokInstance as unknown as { module: { blockSelection: { selectBlockByIndex: (n: number) => void } } }).module.blockSelection;

    bs.selectBlockByIndex(window.blokInstance?.blocks.getBlockIndex(i) ?? -1);
  }, id);
  await page.keyboard.press('Backspace');
  await gap(page);
};

const P = (id: string, text: string, parent?: string): SavedBlock =>
  parent === undefined ? { id, type: 'paragraph', data: { text } } : { id, type: 'paragraph', data: { text }, parent };

const toggleWithKids = (isOpen: boolean): SavedBlock[] => [
  P('top', 'Top'),
  { id: 't', type: 'toggle', data: { text: 'Tog', isOpen }, content: ['k1', 'k2'] },
  P('k1', 'Kid one', 't'),
  P('k2', 'Kid two', 't'),
  P('after', 'After'),
];

const outerWithInner = (innerOpen: boolean): SavedBlock[] => [
  P('top', 'Top'),
  { id: 't', type: 'toggle', data: { text: 'Outer', isOpen: true }, content: ['x', 't2'] },
  P('x', 'Ex', 't'),
  { id: 't2', type: 'toggle', data: { text: 'Inner', isOpen: innerOpen }, parent: 't', content: ['y'] },
  P('y', 'Why', 't2'),
  P('after', 'After'),
];

test.describe('hidden and nested targets', () => {
  // Several tests chain 6+ undo/redo steps with capture gaps; 15s is too tight under load.
  test.describe.configure({ timeout: 45_000 });

  // A block leaving a collapsed toggle must show again: hierarchy.setBlockParent derives `hidden` from the new parent.
  test('W4N-1: undo of Tab into a collapsed toggle shows the block again', async ({ page }) => {
    await createBlok(page, toggleWithKids(false));
    await typeAtEnd(page, 'after', '');
    await page.keyboard.press('Tab');
    await gap(page);
    await undo(page);

    await expect(holder(page, 'after')).toBeVisible({ timeout: 1000 });
    expect(await tree(page)).toContainEqual(['after', null]);
  });

  // Same as W4N-1, through a toggle heading.
  test('W4N-1b: undo of Tab into a collapsed toggle heading shows the block again', async ({ page }) => {
    await createBlok(page, [
      P('top', 'Top'),
      { id: 'h', type: 'header', data: { text: 'Head', level: 2, isToggleable: true, isOpen: false }, content: ['c'] },
      P('c', 'Child', 'h'),
      P('after', 'After'),
    ]);
    await typeAtEnd(page, 'after', '');
    await page.keyboard.press('Tab');
    await gap(page);
    await undo(page);

    await expect(holder(page, 'after')).toBeVisible({ timeout: 1000 });
    expect(await tree(page)).toContainEqual(['after', null]);
  });

  test('control: undo of Tab into an open toggle shows the block', async ({ page }) => {
    await createBlok(page, toggleWithKids(true));
    await typeAtEnd(page, 'after', '');
    await page.keyboard.press('Tab');
    await gap(page);
    expect(await tree(page)).toContainEqual(['after', 't']);
    await undo(page);

    await expect(holder(page, 'after')).toBeVisible();
    expect(await tree(page)).toContainEqual(['after', null]);
  });

  // "Parent is collapsed" reads the parent's OWN toggle marker, not a nested collapsed toggle's.
  test('W4N-2: undo of deleting a block from an open toggle that holds a collapsed toggle shows it again', async ({ page }) => {
    await createBlok(page, outerWithInner(false));
    await selectAndDelete(page, 'x');
    await undo(page);

    await expect(holder(page, 'x')).toBeVisible({ timeout: 1000 });
    expect(await tree(page)).toContainEqual(['x', 't']);
  });

  test('control: undo of deleting a block from an open toggle whose inner toggle is open shows it again', async ({ page }) => {
    await createBlok(page, outerWithInner(true));
    await selectAndDelete(page, 'x');
    await undo(page);

    await expect(holder(page, 'x')).toBeVisible();
    expect(await tree(page)).toContainEqual(['x', 't']);
  });

  // Backspace merges a toggle title into the block above; its children move
  // under that block. The merge re-homes them through the Yjs-writing reparent,
  // so redo puts them back under it, not at root.
  test('W4N-3: redo of merging a toggle title into the block above restores where its children went', async ({ page }) => {
    await createBlok(page, toggleWithKids(true));
    await editable(page, 't').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await gap(page);
    const merged = await save(page);

    await undo(page);
    expect(await save(page)).toEqual(toggleWithKids(true));
    await redo(page);

    expect(await save(page)).toEqual(merged);
  });

  // Right after the merge the Yjs document (what redo and collaborators read)
  // agrees with save() on where the children went.
  test('W4N-3b: after merging a toggle title into the block above, the document agrees on where its children went', async ({ page }) => {
    await createBlok(page, toggleWithKids(true));
    await editable(page, 't').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await gap(page);
    const docParent = await page.evaluate(() => (window.blokInstance as unknown as {
      module: { yjsManager: { getBlockById: (id: string) => { get: (k: string) => unknown } | undefined } };
    }).module.yjsManager.getBlockById('k1')?.get('parentId'));
    const editorParent = (await save(page)).find(b => b.id === 'k1')?.parent;

    expect(docParent).toBe(editorParent);
    expect(editorParent).toBe('top');
  });

  test('control: redo of merging two paragraphs restores the merge', async ({ page }) => {
    await createBlok(page, [P('a', 'Alpha'), P('b', 'Beta')]);
    await editable(page, 'b').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await gap(page);
    const merged = await save(page);

    await undo(page);
    await redo(page);

    expect(await save(page)).toEqual(merged);
  });

  test('works: a space and a letter as two steps, undo then redo puts the letter back after the space', async ({ page }) => {
    await createBlok(page, [P('a', 'Hello')]);
    await typeAtEnd(page, 'a', ' ');
    await gap(page);
    await page.keyboard.type('x');
    await gap(page);
    await undo(page);
    await redo(page);

    expect((await save(page))[0].data).toEqual({ text: 'Hello x' });
  });

  test('works: undo of deleting a collapsed toggle brings its children back hidden', async ({ page }) => {
    await createBlok(page, toggleWithKids(false));
    await selectAndDelete(page, 't');
    await undo(page);

    expect(await save(page)).toEqual(toggleWithKids(false));
    await expect(holder(page, 't')).toBeVisible();
    await expect(holder(page, 'k1')).toBeHidden();
    await expect(holder(page, 'k2')).toBeHidden();
  });

  test('works: edit deep in nested toggles, collapse both, undo expands each before reverting the edit', async ({ page }) => {
    await createBlok(page, [
      P('top', 'Top'),
      { id: 't', type: 'toggle', data: { text: 'Outer', isOpen: true }, content: ['t2'] },
      { id: 't2', type: 'toggle', data: { text: 'Inner', isOpen: true }, parent: 't', content: ['c'] },
      P('c', 'Deep', 't2'),
    ]);
    const s0 = await save(page);

    await typeAtEnd(page, 'c', 'x');
    await gap(page);
    await page.locator('[data-blok-id="t2"] [data-blok-toggle-arrow]').first().click();
    await gap(page);
    await page.locator('[data-blok-id="t"] [data-blok-toggle-arrow]').first().click();
    await gap(page);
    const collapsed = await save(page);

    await editable(page, 'top').click();
    await undo(page);
    await expect(holder(page, 't2')).toBeVisible();
    await undo(page);
    await expect(holder(page, 'c')).toBeVisible();
    await undo(page);
    expect(await save(page)).toEqual(s0);
    await redo(page);
    await redo(page);
    await redo(page);
    expect(await save(page)).toEqual(collapsed);
    await expect(holder(page, 't2')).toBeHidden();
  });

  test('works: toggle > callout > list > nested list, edit and Enter undo/redo exactly', async ({ page }) => {
    await createBlok(page, [
      P('top', 'Top'),
      { id: 't', type: 'toggle', data: { text: 'Tog', isOpen: true }, content: ['co'] },
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, parent: 't', content: ['l1'] },
      { id: 'l1', type: 'list', data: { text: 'Level one', style: 'unordered' }, parent: 'co', content: ['l2'] },
      { id: 'l2', type: 'list', data: { text: 'Level two', style: 'unordered', depth: 1 }, parent: 'l1' },
    ]);
    const s0 = await save(page);
    const d0 = await domTree(page);

    await typeAtEnd(page, 'l2', ' deep');
    await gap(page);
    const s1 = await save(page);
    const d1 = await domTree(page);

    await page.keyboard.press('Enter');
    await gap(page);
    await page.keyboard.type('new item');
    await gap(page);
    const s3 = await save(page);
    const d3 = await domTree(page);

    await undo(page);
    await undo(page);
    expect(await save(page)).toEqual(s1);
    expect(await domTree(page)).toEqual(d1);
    await undo(page);
    expect(await save(page)).toEqual(s0);
    expect(await domTree(page)).toEqual(d0);
    await redo(page);
    await redo(page);
    await redo(page);
    expect(await save(page)).toEqual(s3);
    expect(await domTree(page)).toEqual(d3);
  });

  test('works: column > toggle > paragraph, edit and Enter undo/redo exactly', async ({ page }) => {
    await createBlok(page, [
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['t'] },
      { id: 't', type: 'toggle', data: { text: 'Tog', isOpen: true }, parent: 'c1', content: ['k'] },
      P('k', 'Kid', 't'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['r'] },
      P('r', 'Right', 'c2'),
    ]);
    const s0 = await save(page);
    const d0 = await domTree(page);

    await typeAtEnd(page, 'k', ' A');
    await gap(page);
    await page.keyboard.press('Enter');
    await gap(page);
    await page.keyboard.type('B');
    await gap(page);
    const s3 = await save(page);
    const d3 = await domTree(page);

    await undo(page);
    await undo(page);
    await undo(page);
    expect(await save(page)).toEqual(s0);
    expect(await domTree(page)).toEqual(d0);
    await redo(page);
    await redo(page);
    await redo(page);
    expect(await save(page)).toEqual(s3);
    expect(await domTree(page)).toEqual(d3);
  });

  test('works: edit a toggle-heading child, change the heading level, undo both, redo both', async ({ page }) => {
    await createBlok(page, [
      P('top', 'Top'),
      { id: 'h', type: 'header', data: { text: 'Head', level: 2, isToggleable: true, isOpen: true }, content: ['c'] },
      P('c', 'Child', 'h'),
    ]);
    const s0 = await save(page);

    await typeAtEnd(page, 'c', ' edited');
    await gap(page);
    await page.evaluate(async () => {
      await window.blokInstance?.blocks.update('h', { level: 3 });
    });
    await gap(page);
    const s2 = await save(page);

    await editable(page, 'top').click();
    await undo(page);
    await undo(page);
    expect(await save(page)).toEqual(s0);
    await expect(holder(page, 'c')).toHaveText('Child');
    await redo(page);
    await redo(page);
    expect(await save(page)).toEqual(s2);
    await expect(holder(page, 'c')).toBeVisible();
  });

  test('works: edit a toggle child, move the toggle, undo twice, redo twice', async ({ page }) => {
    await createBlok(page, [
      P('top', 'Top'),
      { id: 't', type: 'toggle', data: { text: 'Tog', isOpen: true }, content: ['c'] },
      P('c', 'Child', 't'),
      P('below', 'Below'),
    ]);
    const s0 = await save(page);
    const d0 = await domTree(page);

    await typeAtEnd(page, 'c', ' edited');
    await gap(page);
    const s1 = await save(page);

    await editable(page, 't').click();
    await page.keyboard.press(MOVE_DOWN);
    await gap(page);
    const s2 = await save(page);
    const d2 = await domTree(page);

    await undo(page);
    expect(await save(page)).toEqual(s1);
    await undo(page);
    expect(await save(page)).toEqual(s0);
    expect(await domTree(page)).toEqual(d0);
    await redo(page);
    await redo(page);
    expect(await save(page)).toEqual(s2);
    expect(await domTree(page)).toEqual(d2);
  });
});

/* ---------------- framework adapters ---------------- */

const IMPORT_MAP = JSON.stringify({
  imports: {
    react: '/test/playwright/fixtures/vendor/react.mjs',
    vue: '/test/playwright/fixtures/vendor/vue.mjs',
    '@bloklabs/core': '/dist/blok.mjs?_v=1',
    '@bloklabs/core/adapters': '/dist/adapters.mjs?_v=1',
    '@bloklabs/core/view': '/dist/view.mjs?_v=1',
    '@bloklabs/core/locales': '/dist/locales.mjs?_v=1',
    'react-dom': '/test/playwright/fixtures/vendor/react-dom.mjs',
    'react-dom/client': '/test/playwright/fixtures/vendor/react-dom-client.mjs',
    'react/jsx-runtime': '/test/playwright/fixtures/vendor/react-jsx-runtime.mjs',
  },
});

// mode: 'none' (uncontrolled), 'onSave' (onSave -> setData), 'onChange' (onChange -> saver.save -> setData).
const REACT_APP = `
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useBlok, BlokContent, createReactBlock } from '/packages/react/dist/index.mjs?_v=1';
const { Paragraph, Header } = await import('/dist/tools.mjs?_v=1');
const mode = new URLSearchParams(location.search).get('mode') || 'none';
window.__w4n = { renders: 0, saves: 0, ready: false };
function Counter({ data, commit }) {
  return jsxs('div', { children: [
    jsx('span', { 'data-blok-testid': 'rc-value', children: String(data.count) }),
    jsx('button', { 'data-blok-testid': 'rc-inc', onClick: () => commit({ count: data.count + 1 }), children: '+1' }),
  ] });
}
const RCounter = createReactBlock({ type: 'rcounter', propSchema: { count: { default: 0 } }, component: Counter });
const INITIAL = { blocks: [
  { id: 'p1', type: 'paragraph', data: { text: 'Hello from React' } },
  { id: 'rc', type: 'rcounter', data: { count: 0 } },
  { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
] };
const TOOLS = { paragraph: { class: Paragraph }, header: { class: Header }, rcounter: RCounter };
function Editor({ data, setData, readOnly }) {
  const cfg = { tools: TOOLS, data, readOnly };
  if (mode === 'onSave') cfg.onSave = (d) => { window.__w4n.saves++; window.__w4n.last = d; setData(d); };
  if (mode === 'onChange') cfg.onChange = async (api) => { const d = await api.saver.save(); window.__w4n.saves++; window.__w4n.last = d; setData(d); };
  const editor = useBlok(cfg);
  useEffect(() => {
    if (!editor) return;
    window.blokInstance = editor;
    const orig = editor.render.bind(editor);
    editor.render = (...a) => { window.__w4n.renders++; return orig(...a); };
    window.__w4n.ready = true;
  }, [editor]);
  return jsx(BlokContent, { editor, 'data-blok-testid': 'editor-container' });
}
function App() {
  const [data, setData] = useState(INITIAL);
  const [ro, setRo] = useState(false);
  const [k, setK] = useState(0);
  const [, force] = useState(0);
  window.__app = { setRo, remount: () => { window.__w4n.ready = false; setK((x) => x + 1); }, rerender: () => force((x) => x + 1) };
  return jsx(Editor, { key: k, data, setData, readOnly: ro });
}
createRoot(document.getElementById('root')).render(jsx(App, {}));
`;

// v-model: onUpdate:data feeds the editor's own output back into the data prop.
const VUE_APP = `
import { createApp, h, ref } from 'vue';
import { BlokEditor, createVueBlock } from '/packages/vue/dist/index.mjs?_v=1';
const { Paragraph, Header } = await import('/dist/tools.mjs?_v=1');
window.__w4n = { renders: 0, saves: 0, ready: false };
const VCounter = createVueBlock({
  type: 'vcounter',
  propSchema: { count: { default: 0 } },
  setup: (ctx) => () => h('div', [
    h('span', { 'data-blok-testid': 'rc-value' }, String(ctx.data.value.count)),
    h('button', { 'data-blok-testid': 'rc-inc', onClick: () => ctx.commit({ count: ctx.data.value.count + 1 }) }, '+1'),
  ]),
});
const App = {
  setup() {
    const data = ref({ blocks: [
      { id: 'p1', type: 'paragraph', data: { text: 'Hello from Vue' } },
      { id: 'rc', type: 'vcounter', data: { count: 0 } },
      { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
    ] });
    const ro = ref(false);
    window.__app = { setRo: (v) => { ro.value = v; }, remount: () => {}, rerender: () => {} };
    return () => h(BlokEditor, {
      'data-blok-testid': 'editor-container',
      tools: { paragraph: { class: Paragraph }, header: { class: Header }, vcounter: { class: VCounter } },
      data: data.value,
      readOnly: ro.value,
      onReady: (ed) => {
        window.blokInstance = ed;
        const orig = ed.render.bind(ed);
        ed.render = (...a) => { window.__w4n.renders++; return orig(...a); };
        window.__w4n.ready = true;
      },
      ...(new URLSearchParams(location.search).get('mode') === 'none' ? {} : { 'onUpdate:data': (next) => { window.__w4n.saves++; window.__w4n.last = next; data.value = next; } }),
    });
  },
};
createApp(App).mount('#root');
`;

const adapterPage = (app: string): string => `<!DOCTYPE html><html><head><meta charset="utf-8"><script type="importmap">${IMPORT_MAP}</script></head>
<body><div id="root"></div><script type="module">${app}</script></body></html>`;

const openAdapter = async (page: Page, kind: 'react' | 'vue', mode = 'none'): Promise<void> => {
  const url = `http://localhost:4444/test/playwright/fixtures/__w4n-${kind}.html`;

  await page.route(`${url}*`, route => route.fulfill({ contentType: 'text/html', body: adapterPage(kind === 'react' ? REACT_APP : VUE_APP) }));
  await page.goto(`${url}?mode=${mode}`);
  await page.waitForFunction(() => window.__w4n?.ready === true);
};

/** The block's data in the last payload the host received through onSave / onChange / update:data. */
const lastEmitted = (page: Page, id: string): Promise<unknown> => page.evaluate(i =>
  window.__w4n?.last?.blocks.find(b => b.id === i)?.data ?? null, id);

const ANGULAR_URL = 'http://localhost:4444/test/playwright/fixtures/angular-test.html';

/** The counter block data in the Angular fixture's last (dataChange) payload. */
const angularEmittedCount = async (page: Page): Promise<unknown> => {
  const raw = await page.getByTestId('output').innerText();
  const parsed = JSON.parse(raw) as OutputData;

  return parsed.blocks.find(b => b.id === 'counter1')?.data ?? null;
};

isolatedTest.describe('framework adapters', () => {
  isolatedTest.describe.configure({ timeout: 45_000 });

  isolatedTest.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  // A replay applied in place through setData must still reach the host's change callback.
  // Adapter hosts are mutation-free, so no DOM change can carry it.
  isolatedTest('W4N-4: undo of a React block change reaches onSave', async ({ page }) => {
    await openAdapter(page, 'react', 'onSave');
    await page.getByTestId('rc-inc').click();
    await gap(page, SAVE_SETTLE);
    expect(await lastEmitted(page, 'rc')).toEqual({ count: 1 });
    await editable(page, 'p2').click();
    await undo(page);
    await gap(page, SAVE_SETTLE);

    expect(await lastEmitted(page, 'rc')).toEqual({ count: 0 });
    await expect(page.getByTestId('rc-value')).toHaveText('0');
  });

  // Same root cause as W4N-4, through the Angular adapter's (dataChange).
  isolatedTest('W4N-4b: undo of an Angular block change reaches (dataChange)', async ({ page }) => {
    await page.goto(ANGULAR_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');
    await page.getByTestId('counter-inc').click();
    await gap(page, SAVE_SETTLE);
    expect(await angularEmittedCount(page)).toEqual({ count: 1 });
    await page.getByTestId('editor-host').locator('[contenteditable="true"]').first().click();
    await undo(page);
    await gap(page, SAVE_SETTLE);

    expect(await angularEmittedCount(page)).toEqual({ count: 0 });
    await expect(page.getByTestId('counter-value')).toHaveText('0');
  });

  isolatedTest('control: undo of React paragraph text reaches onSave', async ({ page }) => {
    await openAdapter(page, 'react', 'onSave');
    await typeAtEnd(page, 'p1', 'Z');
    await gap(page, SAVE_SETTLE);
    expect(await lastEmitted(page, 'p1')).toEqual({ text: 'Hello from ReactZ' });
    await undo(page);
    await gap(page, SAVE_SETTLE);

    expect(await lastEmitted(page, 'p1')).toEqual({ text: 'Hello from React' });
  });

  // Same as W4N-4, through the Vue adapter's v-model.
  isolatedTest('W4N-4c: undo of a Vue block change reaches update:data', async ({ page }) => {
    await openAdapter(page, 'vue', 'vmodel');
    await page.getByTestId('rc-inc').click();
    await gap(page, SAVE_SETTLE);
    expect(await lastEmitted(page, 'rc')).toEqual({ count: 1 });
    await editable(page, 'p2').click();
    await undo(page);
    await gap(page, SAVE_SETTLE);
    expect(await lastEmitted(page, 'rc')).toEqual({ count: 0 });
    await expect(page.getByTestId('rc-value')).toHaveText('0');
  });

  isolatedTest('control: undo of a vanilla toggle collapse reaches onSave', async ({ page }) => {
    await page.goto('http://localhost:4444/test/playwright/fixtures/test.html');
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.evaluate(async () => {
      const d = document.createElement('div');

      d.id = 'blok';
      document.body.appendChild(d);
      const w = window as unknown as { __saved?: unknown };
      const blok = new window.Blok({
        holder: 'blok',
        data: { blocks: [
          { id: 'top', type: 'paragraph', data: { text: 'Top' } },
          { id: 't', type: 'toggle', data: { text: 'Tog', isOpen: true }, content: ['c'] },
          { id: 'c', type: 'paragraph', data: { text: 'Child' }, parent: 't' },
        ] },
        onSave: (out: OutputData) => {
          w.__saved = out.blocks.find(b => b.id === 't')?.data;
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    });
    await page.locator('[data-blok-id="t"] [data-blok-toggle-arrow]').first().click();
    await gap(page, SAVE_SETTLE);
    const read = (): Promise<unknown> => page.evaluate(() => (window as unknown as { __saved?: unknown }).__saved);

    expect(await read()).toEqual({ text: 'Tog', isOpen: false });
    await editable(page, 'top').click();
    await undo(page);
    await gap(page, SAVE_SETTLE);

    expect(await read()).toEqual({ text: 'Tog', isOpen: true });
  });

  // Vue v-model is covered by W4N-5.
  for (const [kind, mode] of [['react', 'none'], ['react', 'onSave'], ['react', 'onChange'], ['vue', 'none']] as const) {
    isolatedTest(`works: ${kind} ${mode}: typing undo/redo with the host echoing data back`, async ({ page }) => {
      await openAdapter(page, kind, mode);
      const original = await page.locator('[data-blok-id="p1"]').innerText();

      await typeAtEnd(page, 'p1', 'Z');
      await gap(page, SAVE_SETTLE);
      await undo(page);
      await gap(page, 800);
      expect((await save(page))[0].data).toEqual({ text: original });
      await expect(holder(page, 'p1')).toHaveText(original);
      expect(await page.evaluate(() => window.blokInstance?.history.canRedo())).toBe(true);
      await redo(page);
      await gap(page, 800);
      expect((await save(page))[0].data).toEqual({ text: `${original}Z` });
      await expect(holder(page, 'p1')).toHaveText(`${original}Z`);
    });
  }

  for (const kind of ['react', 'vue'] as const) {
    isolatedTest(`works: ${kind} block commit undo/redo updates the rendered block`, async ({ page }) => {
      await openAdapter(page, kind, kind === 'vue' ? 'vmodel' : 'none');
      await page.getByTestId('rc-inc').click();
      await gap(page);
      await page.getByTestId('rc-inc').click();
      await gap(page);
      await editable(page, 'p2').click();
      await undo(page);
      await expect(page.getByTestId('rc-value')).toHaveText('1');
      await undo(page);
      await expect(page.getByTestId('rc-value')).toHaveText('0');
      expect((await save(page))[1].data).toEqual({ count: 0 });
      await redo(page);
      await expect(page.getByTestId('rc-value')).toHaveText('1');
      expect((await save(page))[1].data).toEqual({ count: 1 });
    });

    isolatedTest(`works: ${kind} readOnly prop round trip keeps undo/redo`, async ({ page }) => {
      await openAdapter(page, kind, kind === 'vue' ? 'vmodel' : 'none');
      const original = await page.locator('[data-blok-id="p1"]').innerText();

      await typeAtEnd(page, 'p1', 'Z');
      await gap(page);
      await page.evaluate(() => window.__app?.setRo(true));
      await gap(page, 400);
      await page.evaluate(() => window.__app?.setRo(false));
      await gap(page, 400);
      await editable(page, 'p2').click();
      await undo(page);
      await expect(holder(page, 'p1')).toHaveText(original);
      await redo(page);
      await expect(holder(page, 'p1')).toHaveText(`${original}Z`);
    });
  }

  const docText = (page: Page, id: string): Promise<unknown> => page.evaluate(i => (window.blokInstance as unknown as {
    module: { yjsManager: { getBlockById: (b: string) => { get: (k: string) => { get: (k: string) => { toString: () => string } | undefined } | undefined } | undefined } };
  }).module.yjsManager.getBlockById(i)?.get('data')?.get('text')?.toString(), id);

  const spaceThenLetterUndoRedo = async (page: Page, mode: string): Promise<void> => {
    await openAdapter(page, 'vue', mode);
    await typeAtEnd(page, 'p1', ' ');
    await gap(page);
    await page.keyboard.type('x');
    await gap(page, SAVE_SETTLE);
    await editable(page, 'p2').click();
    await undo(page);
    await redo(page);
    await gap(page, 300);
  };

  // Every v-model echo calls readOnly.set(false) on an editable editor. That must be a no-op,
  // or the caret is lost and the letter lands at the start of the paragraph.
  isolatedTest('W4N-5: redo in a Vue v-model editor puts the letter back where it was typed', async ({ page }) => {
    await spaceThenLetterUndoRedo(page, 'vmodel');

    expect(await docText(page, 'p1')).toBe('Hello from Vue x');
    expect((await save(page))[0].data).toEqual({ text: 'Hello from Vue x' });
    expect(await page.evaluate(() => window.__w4n?.renders)).toBe(0);
  });

  isolatedTest('control: the same redo in a Vue editor without v-model puts the letter back', async ({ page }) => {
    await spaceThenLetterUndoRedo(page, 'none');

    expect(await docText(page, 'p1')).toBe('Hello from Vue x');
    expect((await save(page))[0].data).toEqual({ text: 'Hello from Vue x' });
  });

  isolatedTest('works: react parent re-render keeps history, key remount starts a fresh one', async ({ page }) => {
    await openAdapter(page, 'react', 'onSave');
    await typeAtEnd(page, 'p1', 'Z');
    await gap(page, SAVE_SETTLE);
    await page.evaluate(() => window.__app?.rerender());
    await gap(page, 300);
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(true);
    expect(await page.evaluate(() => window.__w4n?.renders)).toBe(0);

    await page.evaluate(() => window.__app?.remount());
    await page.waitForFunction(() => window.__w4n?.ready === true);
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
    await editable(page, 'p2').click();
    await undo(page);
    await expect(holder(page, 'p1')).toHaveText('Hello from ReactZ');
  });

  isolatedTest('works: angular block commit and paragraph text undo/redo', async ({ page }) => {
    await page.goto(ANGULAR_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');
    const para = page.getByTestId('editor-host').locator('[contenteditable="true"]').first();

    await para.click();
    await page.keyboard.press('End');
    await page.keyboard.type('Z');
    await gap(page);
    await page.getByTestId('counter-inc').click();
    await gap(page);
    await para.click();
    await undo(page);
    await expect(page.getByTestId('counter-value')).toHaveText('0');
    await undo(page);
    await expect(para).toHaveText('Hello from Angular');
    await redo(page);
    await redo(page);
    await expect(para).toHaveText('Hello from AngularZ');
    await expect(page.getByTestId('counter-value')).toHaveText('1');
  });
});
