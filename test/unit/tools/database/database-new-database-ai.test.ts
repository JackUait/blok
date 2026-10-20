import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseConfig, DatabaseData, DatabaseSetup, DatabaseSetupRequest } from '../../../../src/tools/database/types';
import type { BlockOrigin } from '../../../../types';
import type { DatabaseTool } from '../../../../src/tools/database';
import { buildDatabase, makeDoc } from './structure-harness';

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

const box = (): HTMLTextAreaElement => {
  const found = panel()?.querySelector('textarea');

  if (!(found instanceof HTMLTextAreaElement)) throw new Error('no prompt box');

  return found;
};
const submit = (): HTMLButtonElement => {
  const found = panel()?.querySelector('[data-blok-testid="database-new-database-ai-submit"]');

  if (!(found instanceof HTMLButtonElement)) throw new Error('no submit');

  return found;
};
const type = (text: string): void => {
  box().value = text;
  box().dispatchEvent(new Event('input', { bubbles: true }));
};
const rowLabels = (): string[] =>
  [...(panel()?.querySelectorAll('[data-blok-database-panel-row]') ?? [])].map((row) => row.querySelector('[data-blok-database-panel-label]')?.textContent ?? '');

const saved = (tool: DatabaseTool): DatabaseData => tool.save(document.createElement('div'));

const fresh = { initialView: 'table' } as unknown as DatabaseData;

const insert = async (setupDatabase?: (request: DatabaseSetupRequest) => Promise<DatabaseSetup | null | undefined>, origin: BlockOrigin = 'user', data: DatabaseData = fresh): Promise<ReturnType<typeof buildDatabase> & { doc: ReturnType<typeof makeDoc> }> => {
  const doc = makeDoc([
    { id: 'other', name: 'database', parentId: null, data: { title: 'Tasks' } },
    { id: 'db', name: 'database', parentId: null, data: {} },
  ]);
  const config: DatabaseConfig = setupDatabase === undefined ? {} : { ai: { autofill: vi.fn(async () => undefined), setupDatabase } };

  const built = buildDatabase(doc, 'db', data, config, origin);

  // The panel opens a frame after the insert.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  return { doc, ...built };
};

describe('"New database" panel with the AI prompt (research/26 §2, research/20 §1a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
    popovers.destroyed = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a database the user inserts opens it when the host gives ai.setupDatabase', async () => {
    await insert(vi.fn(async () => null));

    expect(panel()?.querySelector('[data-blok-database-panel-header]')?.textContent).toBe('tools.database.linkedPanelTitle');
    expect(box().placeholder).toBe('tools.database.aiSetupPlaceholder');
    expect(box().getAttribute('aria-label')).toBe('tools.database.aiSetupPlaceholder');
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(rowLabels()).toEqual(['tools.database.linkedNewEmpty', 'tools.database.linkedLinkExisting']);
  });

  it('opens nothing without the lever', async () => {
    await insert(undefined);

    expect(panel()).toBeUndefined();
  });

  it.each(['load', 'replay', 'api', 'paste'] as const)('opens nothing for a %s origin', async (origin) => {
    await insert(vi.fn(async () => null), origin);

    expect(panel()).toBeUndefined();
  });

  it('opens nothing for a database that was already set up', async () => {
    await insert(vi.fn(async () => null), 'user', { schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], views: [] } as unknown as DatabaseData);

    expect(panel()).toBeUndefined();
  });

  it('submit turns on with text and stays off for spaces only', async () => {
    const setup = vi.fn(async () => null);

    await insert(setup);
    type('   ');
    submit().click();

    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(setup).not.toHaveBeenCalled();
    type('Trips');

    expect(submit().hasAttribute('aria-disabled')).toBe(false);
  });

  it('Enter sends the prompt with the database; the answer builds it and the panel closes', async () => {
    const setup = vi.fn(async (_request: DatabaseSetupRequest): Promise<DatabaseSetup> => ({
      title: 'Trips',
      schema: [
        { id: 'h', name: 'Trip', type: 'title', position: 'a0' },
        { id: 'when', name: 'When', type: 'date', position: 'a1' },
      ],
    }));
    const { tool } = await insert(setup);
    const titleId = saved(tool).schema.find((p) => p.type === 'title')?.id;

    type('Plan my trips');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ databaseId: 'db', prompt: 'Plan my trips' }));
    expect(setup.mock.calls[0][0].schema.map((p) => p.type)).toContain('title');
    await vi.waitFor(() => expect(saved(tool).title).toBe('Trips'));
    const data = saved(tool);

    expect(data.schema.map((p) => [p.id, p.name])).toEqual([[titleId, 'Trip'], ['when', 'When']]);
    expect(data.views[0].visibleProperties).toEqual(['when']);
    expect(data.activeViewId).toBe(data.views[0].id);
    expect(popovers.destroyed).toBe(1);
  });

  it('Shift+Enter does not send', async () => {
    const setup = vi.fn(async () => null);

    await insert(setup);
    type('Trips');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));

    expect(setup).not.toHaveBeenCalled();
  });

  it('while the host works the box is busy; a null answer changes nothing and lets the user try again', async () => {
    const answer: { resolve?: (value: null) => void } = {};
    const setup = vi.fn(() => new Promise<null>((resolve) => {
      answer.resolve = resolve;
    }));
    const { tool } = await insert(setup);
    const before = JSON.stringify(saved(tool));

    type('Trips');
    submit().click();

    expect(box().disabled).toBe(true);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    submit().click();
    expect(setup).toHaveBeenCalledTimes(1);
    answer.resolve?.(null);

    await vi.waitFor(() => expect(box().disabled).toBe(false));
    expect(popovers.destroyed).toBe(0);
    expect(JSON.stringify(saved(tool))).toBe(before);
    expect(box().value).toBe('Trips');
  });

  it('a rejection shows its message and keeps the panel', async () => {
    const setup = vi.fn(async () => {
      throw new Error('quota');
    });
    const { doc } = await insert(setup);

    type('Trips');
    submit().click();

    await vi.waitFor(() => expect(doc.api.notifier.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'assistant.failed {"error":"quota"}' })));
    expect(box().disabled).toBe(false);
  });

  it('Back from "Link to existing data source" comes back to the prompt with its text', async () => {
    await insert(vi.fn(async () => null));
    type('Trips');
    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-link"]')?.click();

    expect(panel()?.querySelector('textarea')).toBeNull();
    panel()?.querySelector<HTMLElement>('[data-blok-database-panel-back]')?.click();

    expect(box().value).toBe('Trips');
  });

  it('"Link to existing data source" turns the block into a view of that database', async () => {
    const { tool } = await insert(vi.fn(async () => null));

    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-link"]')?.click();
    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-existing-other"]')?.click();

    expect(saved(tool).source).toEqual({ databaseId: 'other' });
  });
});
