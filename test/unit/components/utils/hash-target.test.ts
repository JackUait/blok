import { describe, it, expect, afterEach } from 'vitest';
import { resolveHashTarget } from '../../../../src/components/utils/hash-target';

const mountEditor = (html: string): HTMLElement => {
  const holder = document.createElement('div');

  holder.innerHTML = html;
  document.body.appendChild(holder);

  return holder;
};

describe('resolveHashTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves a block id', () => {
    const holder = mountEditor('<div data-blok-id="block-1"><h2>Раздел</h2></div>');

    expect(resolveHashTarget('block-1', holder)).toEqual({
      element: holder.querySelector('[data-blok-id="block-1"]'),
      blockId: 'block-1',
    });
  });

  it('resolves a heading anchor and reports the block that carries it', () => {
    const holder = mountEditor('<div data-blok-id="block-1"><h2 id="h.2y1ok8y7pef0">Раздел</h2></div>');

    expect(resolveHashTarget('h.2y1ok8y7pef0', holder)).toEqual({
      element: document.getElementById('h.2y1ok8y7pef0'),
      blockId: 'block-1',
    });
  });

  it('prefers a block id over a heading anchor of the same name', () => {
    /**
     * Block ids are Blok's own namespace; an anchor is content and could be
     * anything the imported document happened to carry.
     */
    const holder = mountEditor(
      '<div data-blok-id="dup"><h2>Первый</h2></div><div data-blok-id="block-2"><h2 id="dup">Второй</h2></div>'
    );

    expect(resolveHashTarget('dup', holder)?.element).toBe(holder.querySelector('[data-blok-id="dup"]'));
  });

  it('ignores an anchor outside this editor', () => {
    mountEditor('<h2 id="h.elsewhere">Чужой заголовок</h2>');
    const holder = mountEditor('<div data-blok-id="block-1"><h2>Раздел</h2></div>');

    expect(resolveHashTarget('h.elsewhere', holder)).toBeNull();
  });

  it('returns a null block id for an anchor outside any block', () => {
    const holder = mountEditor('<h2 id="h.loose">Раздел</h2>');

    expect(resolveHashTarget('h.loose', holder)).toEqual({
      element: document.getElementById('h.loose'),
      blockId: null,
    });
  });

  it('returns null for an empty hash, an unknown one, or a missing holder', () => {
    const holder = mountEditor('<div data-blok-id="block-1"><h2 id="h.abc">Раздел</h2></div>');

    expect(resolveHashTarget('', holder)).toBeNull();
    expect(resolveHashTarget('h.nope', holder)).toBeNull();
    expect(resolveHashTarget('h.abc', undefined)).toBeNull();
  });

  it('does not throw on a hash that is not a valid selector', () => {
    const holder = mountEditor('<div data-blok-id="block-1"><h2 id="h.abc">Раздел</h2></div>');

    expect(() => resolveHashTarget('a"]b', holder)).not.toThrow();
  });
});
