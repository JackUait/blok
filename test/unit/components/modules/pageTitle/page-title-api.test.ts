import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { Blok as PublicBlok, BlokConfig } from '../../../../../types';

// The src class gets its module APIs by a prototype swap at boot; the published type lists them.
const create = (config: Partial<BlokConfig>): PublicBlok =>
  new Blok({ tools: { paragraph: { class: Paragraph } }, ...config }) as unknown as PublicBlok;

describe('blok.title API', () => {
  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;
  let target: HTMLDivElement | null = null;
  let configured: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    target?.remove();
    configured?.remove();
    configured = null;
    target = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('title.set before ready lands after ready', async () => {
    blok = create({ holder, pageTitle: true });

    blok.title.set('Early');
    await blok.isReady;

    expect(blok.title.get()).toBe('Early');
    expect(holder.querySelector(`[${DATA_ATTR.pageTitle}]`)?.textContent).toBe('Early');
  });

  it('title.set fires onChange with source api and is one undo step', async () => {
    const onChange = vi.fn();

    blok = create({ holder, pageTitle: { onChange } });

    await blok.isReady;
    blok.title.set('Plans');
    blok.history.undo();

    expect(onChange).toHaveBeenNthCalledWith(1, 'Plans', { source: 'api' });
    expect(blok.title.get()).toBe('');
  });

  it('width.set full marks the header too', async () => {
    blok = create({ holder, pageTitle: true });

    await blok.isReady;
    blok.width.set('full');
    const header = holder.querySelector(`[${DATA_ATTR.pageHeader}]`);

    expect(header?.getAttribute(DATA_ATTR.width)).toBe('full');
    blok.width.set('narrow');
    expect(header?.hasAttribute(DATA_ATTR.width)).toBe(false);
  });

  describe('the header carries the wrapper attributes the gutter and content-align CSS key on', () => {
    const header = (): Element | null => document.querySelector(`[${DATA_ATTR.pageHeader}]`);

    it('copies content align, toolbar position and hidden toolbar at boot, also in an outside holder', async () => {
      target = document.createElement('div');
      document.body.appendChild(target);
      blok = create({ holder, pageTitle: { holder: target }, style: { contentAlign: 'center' }, toolbarPosition: 'right', hideToolbar: true });

      await blok.isReady;

      expect(target.contains(header())).toBe(true);
      expect(header()?.getAttribute(DATA_ATTR.contentAlign)).toBe('center');
      expect(header()?.getAttribute(DATA_ATTR.toolbarPosition)).toBe('right');
      expect(header()?.hasAttribute(DATA_ATTR.toolbarHidden)).toBe(true);
    });

    it('follows toolbar.setPosition', async () => {
      blok = create({ holder, pageTitle: true });

      await blok.isReady;
      blok.toolbar.setPosition('right');

      expect(header()?.getAttribute(DATA_ATTR.toolbarPosition)).toBe('right');
    });

    it('follows toolbar.setHidden both ways', async () => {
      blok = create({ holder, pageTitle: true });

      await blok.isReady;
      blok.toolbar.setHidden(true);
      expect(header()?.hasAttribute(DATA_ATTR.toolbarHidden)).toBe(true);

      blok.toolbar.setHidden(false);
      expect(header()?.hasAttribute(DATA_ATTR.toolbarHidden)).toBe(false);
    });

    it('follows chromeless read-only on and off', async () => {
      blok = create({ holder, pageTitle: true, readOnly: { hideControls: true } });

      await blok.isReady;
      expect(header()?.hasAttribute(DATA_ATTR.controlsHidden)).toBe(true);

      await blok.readOnly.set(false);
      expect(header()?.hasAttribute(DATA_ATTR.controlsHidden)).toBe(false);
    });

    it('follows a switch to an RTL locale', async () => {
      blok = create({ holder, pageTitle: true });

      await blok.isReady;
      await blok.i18n.update({ locale: 'ar' });

      expect(header()?.getAttribute(DATA_ATTR.rtl)).toBe('true');
    });
  });

  it('a locale switch to RTL flips the header direction', async () => {
    blok = create({ holder, pageTitle: true });

    await blok.isReady;
    await blok.i18n.update({ locale: 'ar' });

    expect(holder.querySelector(`[${DATA_ATTR.pageHeader}]`)?.getAttribute('dir')).toBe('rtl');
  });

  it('title.mount after ready with an invalid selector throws a clear error and leaves the header placed', async () => {
    blok = create({ holder, pageTitle: true });
    await blok.isReady;

    expect(() => blok?.title.mount('##bad')).toThrow('"##bad" is not a valid selector');
    expect(holder.querySelector(`[${DATA_ATTR.pageHeader}]`)?.isConnected).toBe(true);
  });

  it('title.mount before ready moves the header once ready', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    blok = create({ holder, pageTitle: true });

    blok.title.mount(target);
    await blok.isReady;

    expect(target.querySelector(`[${DATA_ATTR.pageTitle}]`)).not.toBeNull();
  });

  it('title.mount before ready with a missing selector logs and boot still resolves', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    blok = create({ holder, pageTitle: true });

    blok.title.mount('#missing');
    await expect(blok.isReady).resolves.toBeDefined();

    expect(error.mock.calls.some((args) => args.some((arg) => String(arg).includes('#missing')))).toBe(true);
    const header = holder.querySelector(`[${DATA_ATTR.pageHeader}]`);

    expect(header?.nextElementSibling).toBe(holder.querySelector(`[${DATA_ATTR.redactor}]`));
  });

  it('title.mount(null) after the outside holder left the page puts the header back above the blocks', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    blok = create({ holder, pageTitle: { holder: target } });
    await blok.isReady;

    target.remove();
    blok.title.mount(null);
    const header = holder.querySelector(`[${DATA_ATTR.pageHeader}]`);

    expect(header?.nextElementSibling).toBe(holder.querySelector(`[${DATA_ATTR.redactor}]`));
  });

  it('title.mount(el) then title.mount(null) before ready puts the header above the blocks', async () => {
    target = document.createElement('div');
    target.id = 'x';
    document.body.appendChild(target);
    configured = document.createElement('div');
    document.body.appendChild(configured);
    // An outside config holder: with the default spot, a lost null would still look right.
    blok = create({ holder, pageTitle: { holder: configured } });

    blok.title.mount('#x');
    blok.title.mount(null);
    await blok.isReady;

    expect(configured.querySelector(`[${DATA_ATTR.pageHeader}]`)).toBeNull();
    expect(target.querySelector(`[${DATA_ATTR.pageHeader}]`)).toBeNull();
    expect(holder.querySelector(`[${DATA_ATTR.pageHeader}]`)?.nextElementSibling).toBe(holder.querySelector(`[${DATA_ATTR.redactor}]`));
  });

  describe('after Core exists but before ready', () => {
    // One microtask lets Core.init construct the modules; prepare has not run yet.
    const afterInit = (): Promise<void> => Promise.resolve();

    it('title.set lands after ready', async () => {
      blok = create({ holder, pageTitle: true });
      await afterInit();

      blok.title.set('Early');
      await expect(blok.isReady).resolves.toBeDefined();

      expect(blok.title.get()).toBe('Early');
      expect(holder.querySelector(`[${DATA_ATTR.pageTitle}]`)?.textContent).toBe('Early');
    });

    it('title.mount(el) moves the header once ready', async () => {
      target = document.createElement('div');
      document.body.appendChild(target);
      blok = create({ holder, pageTitle: true });
      await afterInit();

      blok.title.mount(target);
      await expect(blok.isReady).resolves.toBeDefined();

      expect(target.querySelector(`[${DATA_ATTR.pageTitle}]`)).not.toBeNull();
    });

    it('title.mount with a missing selector logs and boot resolves', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      blok = create({ holder, pageTitle: true });
      await afterInit();

      blok.title.mount('#missing');
      await expect(blok.isReady).resolves.toBeDefined();

      expect(error.mock.calls.some((args) => args.some((arg) => String(arg).includes('#missing')))).toBe(true);
    });

    it('title.mount with an invalid selector logs and boot resolves', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      blok = create({ holder, pageTitle: true });

      blok.title.mount('##bad');
      await expect(blok.isReady).resolves.toBeDefined();

      expect(error.mock.calls.some((args) => args.some((arg) => String(arg).includes('"##bad" is not a valid selector')))).toBe(true);
    });

    it('title.icon.set lands after ready', async () => {
      blok = create({ holder, pageTitle: true });
      await afterInit();

      blok.title.icon.set({ type: 'emoji', value: '🚀' });
      expect(blok.title.icon.get()).toEqual({ type: 'emoji', value: '🚀' });
      await expect(blok.isReady).resolves.toBeDefined();

      expect(blok.title.icon.get()).toEqual({ type: 'emoji', value: '🚀' });
      expect(holder.querySelector(`[${DATA_ATTR.pageIcon}]`)?.textContent).toBe('🚀');
    });
  });

  describe('record: false', () => {
    const titleIn = (): HTMLElement => {
      const title = holder.querySelector<HTMLElement>(`[${DATA_ATTR.pageTitle}]`);

      if (title === null) {
        throw new Error('no title');
      }

      return title;
    };

    const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

    const type = (text: string): void => {
      const title = titleIn();

      title.textContent = text;
      title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
    };

    it('title.set adds no undo step', async () => {
      blok = create({ holder, pageTitle: true });
      await blok.isReady;

      blok.title.set('Seed', { record: false });
      blok.history.undo();

      expect(blok.title.get()).toBe('Seed');
      expect(blok.history.canUndo()).toBe(false);
    });

    it('title.set after a recorded set wins, and the recorded step is gone', async () => {
      blok = create({ holder, pageTitle: true });
      await blok.isReady;

      blok.title.set('A');
      blok.title.set('B', { record: false });

      expect(blok.title.get()).toBe('B');
      expect(blok.history.canUndo()).toBe(false);
    });

    it('a typing run that goes on after it stays one step, and undo keeps the host value', async () => {
      blok = create({ holder, pageTitle: true, data: { title: 'Doc', blocks: [] } });
      await blok.isReady;

      // Each write in its own task: writes in one task join one step anyway.
      type('DocR');
      await nextTask();
      type('DocRe');
      await nextTask();
      blok.title.set('Host', { record: false });
      await nextTask();
      type('Host!');
      await nextTask();
      blok.history.undo();

      expect(blok.title.get()).toBe('Host');
      expect(blok.history.canUndo()).toBe(false);
    });

    it('title.icon.set adds no undo step', async () => {
      blok = create({ holder, pageTitle: true });
      await blok.isReady;

      blok.title.icon.set({ type: 'emoji', value: '🚀' }, { record: false });
      blok.history.undo();

      expect(blok.title.icon.get()).toEqual({ type: 'emoji', value: '🚀' });
      expect(blok.history.canUndo()).toBe(false);
    });

    it('title.icon.set after a recorded set wins, and the recorded step is gone', async () => {
      blok = create({ holder, pageTitle: true });
      await blok.isReady;

      blok.title.icon.set({ type: 'emoji', value: '🌿' });
      blok.title.icon.set({ type: 'emoji', value: '🚀' }, { record: false });

      expect(blok.title.icon.get()).toEqual({ type: 'emoji', value: '🚀' });
      expect(blok.history.canUndo()).toBe(false);
    });

    it('onChange and onIconChange carry record: false, and a plain set carries no record key', async () => {
      const onChange = vi.fn();
      const onIconChange = vi.fn();

      blok = create({ holder, pageTitle: { onChange, onIconChange } });
      await blok.isReady;

      blok.title.set('Seed', { record: false });
      blok.title.set('Plain');
      blok.title.icon.set({ type: 'emoji', value: '🚀' }, { record: false });

      expect(onChange).toHaveBeenNthCalledWith(1, 'Seed', { source: 'api', record: false });
      expect(onChange.mock.calls[1]?.[1]).toStrictEqual({ source: 'api' });
      expect(onIconChange).toHaveBeenCalledWith({ type: 'emoji', value: '🚀' }, { source: 'api', record: false });
    });

    it('a plain set before ready records a step', async () => {
      blok = create({ holder, pageTitle: true });

      blok.title.set('Seed');
      await blok.isReady;

      expect(blok.history.canUndo()).toBe(true);
    });

    it('title.set with record: false before ready adds no undo step', async () => {
      blok = create({ holder, pageTitle: true });

      blok.title.set('Seed', { record: false });
      await blok.isReady;

      expect(blok.title.get()).toBe('Seed');
      expect(blok.history.canUndo()).toBe(false);
    });

    it('title.icon.set with record: false before ready adds no undo step', async () => {
      blok = create({ holder, pageTitle: true });

      blok.title.icon.set({ type: 'emoji', value: '🚀' }, { record: false });
      await blok.isReady;

      expect(blok.title.icon.get()).toEqual({ type: 'emoji', value: '🚀' });
      expect(blok.history.canUndo()).toBe(false);
    });
  });

  it('a set before ready wins over the config data title', async () => {
    blok = create({ holder, pageTitle: true, data: { title: 'Doc', blocks: [] } });

    blok.title.set('Early');
    expect(blok.title.get()).toBe('Early');
    await blok.isReady;

    expect(blok.title.get()).toBe('Early');
    expect(holder.querySelector(`[${DATA_ATTR.pageTitle}]`)?.textContent).toBe('Early');
  });
});
