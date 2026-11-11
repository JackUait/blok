import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { expect } from '../helpers/shared-page';
import { openFixtureToggles } from '../helpers/toggle-open';
import { blocksAsHtml } from '../helpers/saved-as-html';

export type Blocks = OutputData['blocks'];
export type Flavor = 'full' | 'html' | 'plain';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const HOLDER_ID = 'blok';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

export const createBlok = async (page: Page, blocks: Blocks): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, initialBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    // Hierarchical saves: a fixture with any legacy-shaped block would otherwise save every container in the legacy dialect.
    const blok = new window.Blok({ holder, data: { blocks: initialBlocks }, dataModel: 'hierarchical' });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks });
  await openFixtureToggles(page, { blocks });
};

export const save = async (page: Page): Promise<Blocks> =>
  blocksAsHtml((await page.evaluate(async () => window.blokInstance?.save()))?.blocks ?? []);

export const holder = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"]`);

export const editable = (page: Page, id: string): ReturnType<Page['locator']> =>
  holder(page, id).locator('[contenteditable="true"]').first();

/** Click the block's own text, then Cmd+A twice: text stage, then block stage. */
export const selectByTitle = async (page: Page, id: string): Promise<void> => {
  await editable(page, id).click();
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.press(`${MOD}+A`);
  await expect(holder(page, id)).toHaveAttribute('data-blok-selected', 'true');
};

/** Click one block, Shift+click another. */
export const selectRange = async (page: Page, fromId: string, toId: string): Promise<void> => {
  await editable(page, fromId).click();
  await editable(page, toId).click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-blok-selected="true"]').first()).toBeVisible();
};

/** Press Cmd+A until every block is selected. */
export const selectAll = async (page: Page, startId: string): Promise<void> => {
  await editable(page, startId).click();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(`${MOD}+A`);
  }
  await expect(page.locator('[data-blok-selected="true"]').first()).toBeVisible();
};

/** Ids of the selected blocks whose parent is not selected too. */

/** Fire copy or cut on the first selected holder; capture every MIME it writes. */
export const clipboardEvent = async (page: Page, type: 'copy' | 'cut'): Promise<Record<string, string>> =>
  page.evaluate(async (eventType) => {
    const target = document.querySelector('[data-blok-id][data-blok-selected="true"]') ?? document.activeElement ?? document.body;
    const store: Record<string, string> = {};
    const dt = new DataTransfer();
    const original = dt.setData.bind(dt);

    dt.setData = (format: string, data: string): void => {
      store[format] = data;
      original(format, data);
    };
    const event = new ClipboardEvent(eventType, { bubbles: true, cancelable: true, clipboardData: dt });

    target.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));

    return store;
  }, type);

export const degrade = (clip: Record<string, string>, flavor: Flavor): Record<string, string> => {
  if (flavor === 'full') {
    return clip;
  }
  if (flavor === 'html') {
    return { 'text/html': clip['text/html'] ?? '', 'text/plain': clip['text/plain'] ?? '' };
  }

  return { 'text/plain': clip['text/plain'] ?? '' };
};

/** Click into the target editable, then fire paste with exactly these MIMEs. */
export const pasteInto = async (page: Page, target: ReturnType<Page['locator']>, data: Record<string, string>): Promise<void> => {
  await target.click();
  await page.evaluate((payload) => {
    const dt = new DataTransfer();

    Object.entries(payload).forEach(([k, v]) => dt.setData(k, v));
    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  }, data);
  // eslint-disable-next-line playwright/no-wait-for-timeout -- paste pipeline is async
  await page.waitForTimeout(500);
};

export type Node = { type: string; data: unknown; children: Node[] };

export const tree = (blocks: Blocks, id: string): Node => {
  const block = blocks.find((b) => b.id === id);

  if (block === undefined) {
    return { type: 'MISSING', data: id, children: [] };
  }

  return {
    type: block.type,
    data: block.data,
    children: (block.content ?? []).map((childId) => tree(blocks, childId)),
  };
};

export const childIds = (blocks: Blocks, parentId: string | null): string[] => {
  if (parentId === null) {
    return blocks.filter((b) => b.parent === undefined || b.parent === null).map((b) => b.id ?? '');
  }

  return blocks.find((b) => b.id === parentId)?.content ?? [];
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Index of a contiguous run of `expected` among the children of `parentId`, or -1. */
export const findRun = (blocks: Blocks, parentId: string | null, expected: Node[], skipIds: Set<string>): number => {
  const kids = childIds(blocks, parentId).filter((id) => !skipIds.has(id)).map((id) => tree(blocks, id));

  for (let i = 0; i + expected.length <= kids.length; i++) {
    if (expected.every((node, j) => same(node, kids[i + j]))) {
      return i;
    }
  }

  return -1;
};

/** Structural problems in a save: duplicate ids, broken parent/content links. */
export const integrity = (blocks: Blocks): string[] => {
  const problems: string[] = [];
  const ids = blocks.map((b) => b.id ?? '');
  const byId = new Map(blocks.map((b) => [b.id ?? '', b]));

  ids.forEach((id, i) => {
    if (ids.indexOf(id) !== i) {
      problems.push(`duplicate id ${id}`);
    }
  });
  blocks.forEach((b) => {
    if (b.parent !== undefined && b.parent !== null) {
      const parent = byId.get(b.parent);

      if (parent === undefined) {
        problems.push(`${b.id} parent ${b.parent} missing`);
      } else if (!(parent.content ?? []).includes(b.id ?? '')) {
        problems.push(`${b.id} not in content of parent ${b.parent}`);
      }
    }
    if (b.type === 'table') {
      const rows = (b.data as { content?: Array<Array<{ blocks?: string[] }>> }).content ?? [];

      rows.flat().flatMap((cell) => cell.blocks ?? []).forEach((ref) => {
        if (!(b.content ?? []).includes(ref)) {
          problems.push(`table ${b.id} cell ref ${ref} not among its children`);
        }
      });
    }
    (b.content ?? []).forEach((childId) => {
      const child = byId.get(childId);

      if (child === undefined) {
        problems.push(`${b.id} content ${childId} missing`);
      } else if (child.parent !== b.id) {
        problems.push(`${childId} listed in ${b.id} but parent=${String(child.parent)}`);
      }
    });
  });

  return problems;
};

/** DOM problems: a saved child holder outside its parent holder, a root inside another holder, wrong order. */
export const domIntegrity = async (page: Page, blocks: Blocks): Promise<string[]> =>
  page.evaluate((saved) => {
    const problems: string[] = [];
    const find = (id: string): HTMLElement | null => document.querySelector(`[data-blok-id="${id}"]`);

    saved.forEach((b) => {
      const el = find(b.id ?? '');

      if (el === null) {
        problems.push(`no holder for ${b.id}`);

        return;
      }
      const upHolder = el.parentElement?.closest('[data-blok-id]') ?? null;

      if (b.parent === undefined || b.parent === null) {
        if (upHolder !== null) {
          problems.push(`root ${b.id} rendered inside ${upHolder.getAttribute('data-blok-id')}`);
        }
      } else if (upHolder?.getAttribute('data-blok-id') !== b.parent) {
        // A flow-nested child (parent has no child slot) renders as the parent's sibling, after it.
        const parentEl = find(b.parent);
        const flow = parentEl !== null
          && parentEl.querySelector('[data-blok-nested-blocks]') === null
          && (parentEl.parentElement?.closest('[data-blok-id]') ?? null) === upHolder
          && (parentEl.compareDocumentPosition(el) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

        if (!flow) {
          problems.push(`${b.id} rendered under ${upHolder?.getAttribute('data-blok-id') ?? 'ROOT'} but parent=${b.parent}`);
        }
      }
      const kids = b.type === 'table' ? [] : (b.content ?? []).map(find).filter((k): k is HTMLElement => k !== null);

      for (let i = 1; i < kids.length; i++) {
        if ((kids[i - 1].compareDocumentPosition(kids[i]) & window.Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
          problems.push(`children of ${b.id} out of DOM order at ${i}`);
        }
      }
    });

    return problems;
  }, blocks);

/** What a reader sees of a subtree: toggle open states, column widths, tab strip. */
export const layout = async (page: Page, id: string): Promise<unknown> =>
  page.evaluate((rootId) => {
    const root = document.querySelector(`[data-blok-id="${rootId}"]`);

    if (root === null) {
      return null;
    }

    return {
      toggles: Array.from(root.querySelectorAll('[data-blok-toggle-open]')).map((el) => el.getAttribute('data-blok-toggle-open')),
      grows: Array.from(root.querySelectorAll<HTMLElement>('[data-blok-column]'))
        .map((el) => el.closest<HTMLElement>('[data-blok-id]')?.style.flexGrow ?? ''),
      tabs: Array.from(root.querySelectorAll('[role="tab"]')).map((el) => `${el.textContent?.trim() ?? ''}:${el.getAttribute('aria-selected') ?? ''}`),
      text: (root as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
    };
  }, id);
