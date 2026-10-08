import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import Blok from '../../../../../src/blok';
import { Core } from '../../../../../src/components/core';
import { modificationsObserverBatchTimeout } from '../../../../../src/components/constants';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Blok as PublicBlok, BlokConfig, OutputData } from '../../../../../types';

// The src class gets its module APIs by a prototype swap at boot; the published type lists them.
const create = (config: Partial<BlokConfig>): PublicBlok =>
  new Blok({ tools: { paragraph: { class: Paragraph } }, ...config }) as unknown as PublicBlok;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const closeWindow = (): Promise<void> => wait(modificationsObserverBatchTimeout + 100);
const DOC: OutputData = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] };

const fireBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

describe('page title edits reach onSave', () => {
  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  const titleIn = (): HTMLElement => {
    const title = holder.querySelector<HTMLElement>(`[${DATA_ATTR.pageTitle}]`);

    if (title === null) {
      throw new Error('no title');
    }

    return title;
  };

  const type = (text: string): void => {
    const title = titleIn();

    title.textContent = text;
    title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
  };

  const boot = async (config: Partial<BlokConfig> = {}): Promise<{ onSave: ReturnType<typeof vi.fn> }> => {
    const onSave = vi.fn();

    blok = create({ holder, data: DOC, onSave, pageTitle: true, ...config });
    await blok.isReady;
    // A boot-time save would be counted below.
    await closeWindow();
    onSave.mockClear();

    return { onSave };
  };

  it('typing in the title calls onSave once, with the new title', async () => {
    const { onSave } = await boot();

    type('R');
    type('Re');
    type('Renamed');
    await closeWindow();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ title: 'Renamed' });
  });

  it('blok.title.set calls onSave', async () => {
    const { onSave } = await boot();

    blok?.title.set('From the host');
    await closeWindow();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ title: 'From the host' });
  });

  it('an icon change calls onSave', async () => {
    const { onSave } = await boot();

    blok?.title.icon.set({ type: 'emoji', value: '🚀' });
    await closeWindow();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ icon: { type: 'emoji', value: '🚀' } });
  });

  it('a title set to the value it already has calls neither onSave nor the title onChange', async () => {
    const onChange = vi.fn();
    const onIconChange = vi.fn();
    const { onSave } = await boot({ data: { ...DOC, title: 'Same', icon: { type: 'emoji', value: '🚀' } }, pageTitle: { onChange, onIconChange } });

    blok?.title.set('Same');
    blok?.title.icon.set({ type: 'emoji', value: '🚀' });
    await closeWindow();

    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onIconChange).not.toHaveBeenCalled();
  });

  it('undo of a title edit calls onSave again', async () => {
    const { onSave } = await boot();

    blok?.title.set('Renamed');
    await closeWindow();
    onSave.mockClear();
    blok?.history.undo();
    await closeWindow();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('title');
  });

  it('a read-only editor saves nothing for an API title write', async () => {
    const { onSave } = await boot();

    await blok?.readOnly.set(true);
    await closeWindow();
    onSave.mockClear();
    blok?.title.set('Renamed');
    await closeWindow();

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('remote page edits', () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('a peer rename calls no onSave', async () => {
    const onSave = vi.fn();
    const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: DOC, onSave, pageTitle: true });

    await core.isReady;
    await closeWindow();
    onSave.mockClear();
    const yjs = core.moduleInstances.YjsManager;
    const peer = new Y.Doc();

    Y.applyUpdate(peer, yjs.encodeStateAsUpdate());
    peer.getMap('page').set('title', 'From a peer');
    yjs.applyRemoteUpdate(Y.encodeStateAsUpdate(peer), { source: 'peer' });
    await closeWindow();

    expect(yjs.getPageFields().title).toBe('From a peer');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('page title edits with persistence', () => {
  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('a title edit arms the leave prompt and reaches persistence.save', async () => {
    const save = vi.fn(async () => undefined);

    blok = create({ holder, pageTitle: true, persistence: { load: async () => DOC, save } });
    await blok.isReady;
    await closeWindow();
    save.mockClear();

    const title = holder.querySelector<HTMLElement>(`[${DATA_ATTR.pageTitle}]`);

    if (title === null) {
      throw new Error('no title');
    }
    title.textContent = 'Renamed';
    title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'd' }));

    expect(fireBeforeUnload()).toBe(true);
    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 });
    expect(JSON.stringify(save.mock.calls.at(-1))).toContain('Renamed');
  });
});
