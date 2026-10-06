import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTool } from '../../../../src/tools/page';
import type { PageConfig, PageData, PageInfo } from '../../../../src/tools/page/types';
import type { API, BlockOrigin, BlockToolConstructorOptions } from '../../../../types';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createMockAPI = (): API =>
  ({
    i18n: { t: (key: string) => key, has: () => true },
  }) as unknown as API;

interface Setup {
  data?: Partial<PageData>;
  config?: PageConfig;
  readOnly?: boolean;
  origin?: BlockOrigin;
  replaySource?: 'history' | 'remote';
  dispatchChange?: ReturnType<typeof vi.fn>;
}

const createOptions = ({
  data = { pageId: 'p1' },
  config = {},
  readOnly = false,
  origin = 'load',
  replaySource,
  dispatchChange = vi.fn(),
}: Setup = {}): BlockToolConstructorOptions<PageData, PageConfig> => ({
  api: createMockAPI(),
  block: { dispatchChange } as never,
  config,
  readOnly,
  data: data as PageData,
  origin,
  ...(replaySource !== undefined && { replaySource }),
});

describe('Page tool safe metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never displays or saves a legacy cache without an authorized response', async () => {
    const legacy = {
      pageId: 'p1',
      cache: { title: 'Private plan', icon: { type: 'emoji' as const, value: '🔐' } },
    };
    const dispatchChange = vi.fn();
    const href = vi.fn(() => '/pages/p1');
    const tool = new PageTool(createOptions({
      data: legacy,
      config: { resolve: () => undefined, href },
      dispatchChange,
    }));
    const root = tool.render();

    tool.rendered();
    await flush();

    expect(root.textContent).not.toContain('Private plan');
    expect(root.textContent).not.toContain('🔐');
    expect(root.textContent).toContain('tools.page.unresolved');
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(href).not.toHaveBeenCalled();
    expect(tool.save()).toEqual({ pageId: 'p1' });
    expect(dispatchChange).not.toHaveBeenCalled();
  });

  it('keeps a newer denial when two responses for the same page arrive out of order', async () => {
    const pending: Array<(info: PageInfo) => void> = [];
    let notify: (() => void) | undefined;
    const tool = new PageTool(createOptions({
      config: {
        resolve: () => new Promise<PageInfo>((done) => pending.push(done)),
        subscribe: (_id, onChange) => {
          notify = onChange;
        },
      },
    }));
    const root = tool.render();

    tool.rendered();
    await flush();
    notify?.();
    await flush();

    expect(pending).toHaveLength(2);
    pending[1]?.({ access: 'none' });
    await flush();
    expect(root.textContent).toContain('tools.page.noAccess');

    pending[0]?.({ title: 'Private plan' });
    await flush();

    expect(root.textContent).not.toContain('Private plan');
    expect(root.textContent).toContain('tools.page.noAccess');
    expect(tool.save()).toEqual({ pageId: 'p1' });
  });

  it('clears an allowed title immediately when a notification starts an access recheck', async () => {
    let notify: (() => void) | undefined;
    let finish: ((info: PageInfo) => void) | undefined;
    let requests = 0;
    const dispatchChange = vi.fn();
    const tool = new PageTool(createOptions({
      config: {
        resolve: () => {
          requests += 1;

          return requests === 1
            ? Promise.resolve({ title: 'Visible' })
            : new Promise<PageInfo>((done) => { finish = done; });
        },
        subscribe: (_id, onChange) => {
          notify = onChange;
        },
      },
      dispatchChange,
    }));
    const root = tool.render();

    tool.rendered();
    await flush();
    expect(root.textContent).toContain('Visible');

    notify?.();
    expect(root.textContent).not.toContain('Visible');
    expect(root.textContent).toContain('tools.page.unresolved');
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);

    await flush();
    finish?.({ access: 'none' });
    await flush();
    expect(root.textContent).toContain('tools.page.noAccess');
    expect(dispatchChange).not.toHaveBeenCalled();
  });

  it('ignores an old page response after setData points to another page', async () => {
    const pending: Record<string, ((info: PageInfo) => void) | undefined> = {};
    const tool = new PageTool(createOptions({
      data: { pageId: 'p1', cache: { title: 'Private plan' } },
      config: {
        href: (id) => `/pages/${id}`,
        resolve: (id) => new Promise<PageInfo>((done) => { pending[id] = done; }),
      },
    }));
    const root = tool.render();

    tool.rendered();
    await flush();
    tool.setData({ pageId: 'p2', cache: { title: 'Other cached title' } });

    expect(root.textContent).not.toContain('Private plan');
    expect(root.textContent).not.toContain('Other cached title');
    expect(root.textContent).toContain('tools.page.unresolved');
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);

    pending.p1?.({ title: 'Private plan' });
    await flush();
    expect(root.textContent).not.toContain('Private plan');

    pending.p2?.({ title: 'Allowed p2' });
    await flush();
    expect(root.textContent).toContain('Allowed p2');
    expect(tool.save()).toEqual({ pageId: 'p2' });
  });
});
