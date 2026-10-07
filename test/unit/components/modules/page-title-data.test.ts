import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import type { CollaborationConfig } from '../../../../src/components/modules/collaboration';
import { YjsManager } from '../../../../src/components/modules/yjs';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { BlokConfig } from '../../../../types';

/** A socket that never opens, so a collaboration boot makes no network call. */
class IdleSocket {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  public send(): void {}

  public close(): void {
    this.readyState = 3;
  }
}

// The internal config type: `socketFactory` is not on the public one.
const collaboration: CollaborationConfig = { doc: 'doc-1', socketFactory: () => new IdleSocket() };

const COLLAB_CONFIG_WITHOUT_SERVER: Pick<BlokConfig, 'server' | 'collaboration'> = {
  server: 'https://sync.test/api/',
  collaboration,
};

/** Blok.destroy()'s module teardown, so the collaboration boot leaks no timers. */
const destroyCore = (core: Core): void => {
  const instances = Object.values(core.moduleInstances) as Array<{
    markDestroyed?: () => void;
    destroy?: () => void;
    listeners?: { removeAll?: () => void };
  } | null | undefined>;

  // Mark every module first: a destroy() that runs before its peers are marked reads torn-down state.
  instances.forEach((instance) => instance?.markDestroyed?.());
  instances.forEach((instance) => {
    instance?.destroy?.();
    instance?.listeners?.removeAll?.();
  });
};

describe('page title save and load', () => {
  let holder: HTMLDivElement;
  const booted: Core[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (config: Partial<BlokConfig> = {}): Promise<Core> => {
    const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, ...config });

    await core.isReady;
    booted.push(core);

    return core;
  };

  it('saves the loaded title and icon', async () => {
    const core = await boot({ data: { title: 'Plans', icon: { type: 'emoji', value: '🚀' }, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });
    const saved = await core.moduleInstances.Saver.save();

    expect(saved?.title).toBe('Plans');
    expect(saved?.icon).toEqual({ type: 'emoji', value: '🚀' });
  });

  it('keeps the title when the document has no blocks (default block path)', async () => {
    const core = await boot({ data: { title: 'Plans', blocks: [] } });
    const saved = await core.moduleInstances.Saver.save();

    expect(saved?.title).toBe('Plans');
  });

  it('saves no title field for an untitled page', async () => {
    const core = await boot({ data: { blocks: [] } });
    const saved = await core.moduleInstances.Saver.save();

    expect(saved).not.toHaveProperty('title');
    expect(saved).not.toHaveProperty('icon');
  });

  it('render() with the same blocks and a new title updates the title', async () => {
    const blocks = [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }];
    const core = await boot({ data: { title: 'Old', blocks } });

    await core.moduleInstances.API.methods.blocks.render({ title: 'New', blocks });

    expect(core.moduleInstances.YjsManager.getPageFields().title).toBe('New');
  });

  it('render() without a title clears it', async () => {
    const core = await boot({ data: { title: 'Old', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });

    await core.moduleInstances.API.methods.blocks.render({ blocks: [{ id: 'p2', type: 'paragraph', data: { text: 'other' } }] });

    expect(core.moduleInstances.YjsManager.getPageFields()).toEqual({});
  });

  it('does not seed the config title when collaboration owns the document', async () => {
    const loadPage = vi.spyOn(YjsManager.prototype, 'loadPage');

    // The `server` shorthand fills in a bookmark endpoint, so that tool needs a class.
    await boot({
      data: { title: 'Local', blocks: [] },
      tools: { paragraph: { class: Paragraph }, bookmark: { class: Bookmark } },
      ...COLLAB_CONFIG_WITHOUT_SERVER,
    });

    expect(loadPage).not.toHaveBeenCalled();
  });
});
