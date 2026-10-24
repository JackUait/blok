import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig } from '../../../../../types';

describe('PageTitle teardown', () => {
  let holder: HTMLDivElement;
  let editor: Blok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    try {
      if (editor !== null && typeof editor.destroy === 'function') {
        editor.destroy();
      }
    } finally {
      editor = null;
      holder.remove();
      vi.restoreAllMocks();
    }
  });

  const boot = async (config: BlokConfig): Promise<Blok> => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph },
      data: { blocks: [{ type: 'paragraph', data: { text: 'Hello' } }] },
      i18n: { locale: 'en' },
      tabSync: false,
      ...config,
    });

    editor = instance;
    await instance.isReady;

    return instance;
  };

  it.each([
    { setting: 'omitted', config: {} },
    { setting: 'false', config: { pageTitle: false } },
  ])('tears down without warnings when pageTitle is $setting', async ({ config }) => {
    const instance = await boot(config);
    const title = holder.querySelector(`[${DATA_ATTR.pageTitle}]`);
    const warn = vi.spyOn(console, 'warn');

    instance.destroy();

    expect(warn).not.toHaveBeenCalled();
    expect(title).toBeNull();
    expect(holder.childElementCount).toBe(0);
  });

  it('relabels an enabled title and removes it without teardown warnings', async () => {
    const instance = await boot({ pageTitle: true });
    const title = holder.querySelector<HTMLElement>(`[${DATA_ATTR.pageTitle}]`);

    if (title === null) {
      throw new Error('The enabled page title was not rendered.');
    }
    await instance.i18n.update({
      messages: {
        'title.placeholder': 'Document name',
        'title.ariaLabel': 'Document title',
      },
    });

    expect(title.getAttribute('data-placeholder')).toBe('Document name');
    expect(title.getAttribute('aria-label')).toBe('Document title');

    const warn = vi.spyOn(console, 'warn');

    instance.destroy();

    expect(warn).not.toHaveBeenCalled();
    expect(title.isConnected).toBe(false);
    expect(holder.childElementCount).toBe(0);
  });
});
