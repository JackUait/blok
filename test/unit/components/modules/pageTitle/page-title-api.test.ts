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

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    target?.remove();
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

  it('a locale switch to RTL flips the header direction', async () => {
    blok = create({ holder, pageTitle: true });

    await blok.isReady;
    await blok.i18n.update({ locale: 'ar' });

    expect(holder.querySelector(`[${DATA_ATTR.pageHeader}]`)?.getAttribute('dir')).toBe('rtl');
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

      expect(error.mock.calls.some((args) => args.some((arg) => String(arg).includes('##bad')))).toBe(true);
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

  it('a set before ready wins over the config data title', async () => {
    blok = create({ holder, pageTitle: true, data: { title: 'Doc', blocks: [] } });

    blok.title.set('Early');
    expect(blok.title.get()).toBe('Early');
    await blok.isReady;

    expect(blok.title.get()).toBe('Early');
    expect(holder.querySelector(`[${DATA_ATTR.pageTitle}]`)?.textContent).toBe('Early');
  });
});
