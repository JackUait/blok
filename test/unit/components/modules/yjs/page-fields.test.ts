import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Core } from '../../../../../src/components/core';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { YjsManager } from '../../../../../src/components/modules/yjs';

describe('YjsManager page fields', () => {
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

  const boot = async (): Promise<YjsManager> => {
    const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [] } });

    await core.isReady;

    return core.moduleInstances.YjsManager;
  };

  it('undoes a title write and tells the listener the source', async () => {
    const yjs = await boot();
    const listener = vi.fn();

    yjs.onPageChange(listener);
    yjs.setPageField('title', 'Plans');
    yjs.stopCapturing();
    yjs.undo();

    expect(yjs.getPageFields()).toEqual({});
    expect(listener).toHaveBeenCalledWith('title', 'undo');
  });

  it('keeps one typing run as one undo step', async () => {
    const yjs = await boot();

    yjs.setPageField('title', 'P', { typing: true });
    yjs.setPageField('title', 'Pl', { typing: true });
    yjs.setPageField('title', 'Pla', { typing: true });
    yjs.stopCapturing();
    yjs.undo();

    expect(yjs.getPageFields()).toEqual({});
  });

  it('undoes an icon change', async () => {
    const yjs = await boot();

    yjs.setPageField('icon', { type: 'emoji', value: '🚀' });
    yjs.stopCapturing();
    yjs.undo();

    expect(yjs.getPageFields().icon).toBeUndefined();
  });

  it('does not put a load in the undo history', async () => {
    const yjs = await boot();

    yjs.loadPage({ title: 'Loaded' });
    yjs.undo();

    expect(yjs.getPageFields()).toEqual({ title: 'Loaded' });
  });

  it('reports a peer write as remote', async () => {
    const yjs = await boot();
    const listener = vi.fn();
    const peer = new Y.Doc();

    yjs.onPageChange(listener);
    Y.applyUpdate(peer, yjs.encodeStateAsUpdate());
    peer.getMap('page').set('title', 'From a peer');
    yjs.applyRemoteUpdate(Y.encodeStateAsUpdate(peer), { source: 'peer' });

    expect(yjs.getPageFields()).toEqual({ title: 'From a peer' });
    expect(listener).toHaveBeenCalledWith('title', 'remote');
  });

  it('keeps listening after a lineage reset', async () => {
    const yjs = await boot();
    const listener = vi.fn();
    const peer = new Y.Doc();

    yjs.onPageChange(listener);
    yjs.resetForRelineage();
    peer.getMap('page').set('title', 'After reset');
    yjs.applyRemoteUpdate(Y.encodeStateAsUpdate(peer), { source: 'peer' });

    expect(listener).toHaveBeenCalledWith('title', 'remote');
  });

  it('a host track() key named title does not touch the page title', async () => {
    const yjs = await boot();

    yjs.setValue('title', 'host value');

    expect(yjs.getPageFields()).toEqual({});
  });
});
