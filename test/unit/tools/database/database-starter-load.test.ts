import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData } from '../../../../src/tools/database/types';
import type { DatabaseTool } from '../../../../src/tools/database';
import { buildDatabase, makeDoc } from './structure-harness';
import type { Doc } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const popovers = vi.hoisted(() => ({ items: [] as unknown[][], destroyed: 0 }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    constructor(params: { items?: unknown[] } = {}) {
      popovers.items.push(params.items ?? []);
    }

    show(): void {}

    hide(): void {}

    destroy(): void {
      popovers.destroyed += 1;
    }

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

type HtmlItem = { element?: HTMLElement };

const panel = (): HTMLElement | undefined => (popovers.items as HtmlItem[][])
  .flat()
  .map((item) => item.element)
  .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getAttribute('data-blok-testid') === 'database-new-database-panel')
  .at(-1);

const byTestId = (root: ParentNode | undefined, id: string): HTMLElement => {
  const found = root?.querySelector(`[data-blok-testid="${id}"]`);

  if (!(found instanceof HTMLElement)) throw new Error(`no ${id}`);

  return found;
};
const modal = (): HTMLElement | null => document.querySelector('[data-blok-testid="database-starter-modal"]');

const builder = vi.hoisted(() => ({ fail: 0 }));

vi.mock('../../../../src/tools/database/database-starter-build', async (importOriginal) => {
  if (builder.fail > 0) {
    builder.fail -= 1;
    throw new Error('chunk load failed');
  }

  return importOriginal();
});

const insert = async (): Promise<{ doc: Doc; tool: DatabaseTool }> => {
  const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
  const { tool } = buildDatabase(doc, 'db', { initialView: 'table' } as unknown as DatabaseData, {}, 'user');

  await new Promise((resolve) => requestAnimationFrame(resolve));

  return { doc, tool };
};

describe('the template builder loads when a template is picked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
    popovers.destroyed = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a failed load shows an error and builds nothing', async () => {
    builder.fail = 1;
    const { doc } = await insert();
    const before = doc.transact.mock.calls.length;

    byTestId(panel(), 'database-new-database-starter-tasks').click();
    await vi.waitFor(() => expect(doc.api.notifier.show).toHaveBeenCalledWith({ message: 'tools.stub.error', style: 'error' }));
    expect(modal()).toBeNull();
    expect(doc.transact.mock.calls.length).toBe(before);
  });
});
