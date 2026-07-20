/**
 * Public runtime theme-token API (`instance.tokens`).
 *
 * `config.style.tokens` was construction-time only, so a host with a live
 * light/dark toggle could not use it and fell back to hand-writing the global
 * stylesheet Blok already injects. This API exposes the same channel at
 * runtime, mirroring theme/width/placeholder: available immediately after
 * construction, buffered before isReady, replayed once UI exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../src/blok';

const tokenTags = (): HTMLStyleElement[] =>
  Array.from(document.head.querySelectorAll<HTMLStyleElement>('style')).filter(tag =>
    tag.id.startsWith('blok-theme-tokens-')
  );

const createEditor = async (): Promise<Blok> => {
  const holder = document.createElement('div');

  holder.id = 'tokens-api-editor';
  document.body.appendChild(holder);

  const editor = new Blok({ holder, minHeight: 50 });

  await editor.isReady;

  return editor;
};

describe('Blok tokens API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    tokenTags().forEach(tag => tag.remove());
    vi.restoreAllMocks();
  });

  it('is exposed synchronously, before isReady resolves', () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({ holder, minHeight: 50 });

    expect(typeof editor.tokens.set).toBe('function');
    expect(typeof editor.tokens.get).toBe('function');
  });

  it('applies tokens set after the editor is ready', async () => {
    const editor = await createEditor();

    editor.tokens.set({ '--blok-popover-bg': '#1f1f1f' });

    expect(tokenTags()[0]?.textContent).toContain('--blok-popover-bg: #1f1f1f;');
    expect(editor.tokens.get()).toEqual({ '--blok-popover-bg': '#1f1f1f' });
  });

  it('buffers tokens set before isReady and replays them once UI exists', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({ holder, minHeight: 50 });

    editor.tokens.set({ '--blok-popover-bg': '#1f1f1f' });

    expect(editor.tokens.get()).toEqual({ '--blok-popover-bg': '#1f1f1f' });

    await editor.isReady;

    expect(tokenTags()[0]?.textContent).toContain('--blok-popover-bg: #1f1f1f;');
  });

  it('replaces the token set on each call, so a theme flip drops stale tokens', async () => {
    const editor = await createEditor();

    editor.tokens.set({ '--blok-popover-bg': '#ffffff', '--blok-text-primary': '#000000' });
    editor.tokens.set({ '--blok-popover-bg': '#1f1f1f' });

    const css = tokenTags()[0]?.textContent ?? '';

    expect(css).toContain('--blok-popover-bg: #1f1f1f;');
    expect(css).not.toContain('--blok-text-primary');
    expect(editor.tokens.get()).toEqual({ '--blok-popover-bg': '#1f1f1f' });
  });

  it('seeds get() from config.style.tokens', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);

    const editor = new Blok({
      holder,
      minHeight: 50,
      style: { tokens: { '--blok-popover-bg': '#1f1f1f' } },
    });

    await editor.isReady;

    expect(editor.tokens.get()).toEqual({ '--blok-popover-bg': '#1f1f1f' });
  });
});
