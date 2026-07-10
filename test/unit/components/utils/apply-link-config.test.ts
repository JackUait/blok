import { describe, it, expect, vi } from 'vitest';

import { applyLinkConfig } from '../../../../src/components/utils/apply-link-config';

const makeRoot = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;

  return root;
};

describe('applyLinkConfig', () => {
  it('forces the default target and rel on anchors when neither is configured', () => {
    const root = makeRoot('<a href="https://example.com/">link</a>');

    applyLinkConfig(root, {});

    const anchor = root.querySelector('a');

    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('nofollow');
  });

  it('applies the configured target and rel, overriding existing attributes', () => {
    const root = makeRoot('<a href="https://example.com/" target="_self" rel="noopener">link</a>');

    applyLinkConfig(root, { target: '_top', rel: 'noreferrer' });

    const anchor = root.querySelector('a');

    expect(anchor?.getAttribute('target')).toBe('_top');
    expect(anchor?.getAttribute('rel')).toBe('noreferrer');
  });

  it('runs transformHref against the existing href and writes back the result', () => {
    const root = makeRoot('<a href="https://kb.internal/page">link</a>');
    const transformHref = vi.fn((href: string) => `https://public.example/?u=${encodeURIComponent(href)}`);

    applyLinkConfig(root, { transformHref });

    const anchor = root.querySelector('a');

    expect(transformHref).toHaveBeenCalledWith('https://kb.internal/page');
    expect(anchor?.getAttribute('href')).toBe('https://public.example/?u=https%3A%2F%2Fkb.internal%2Fpage');
  });

  it('does not call transformHref for anchors without an href but still applies target/rel', () => {
    const root = makeRoot('<a>no href anchor</a>');
    const transformHref = vi.fn((href: string) => href);

    applyLinkConfig(root, { transformHref });

    const anchor = root.querySelector('a');

    expect(transformHref).not.toHaveBeenCalled();
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('nofollow');
  });

  it('processes every anchor, including nested ones', () => {
    const root = makeRoot('<p><a href="https://a.test/">a</a></p><blockquote><a href="https://b.test/">b</a></blockquote>');
    const transformHref = vi.fn((href: string) => `${href}#x`);

    applyLinkConfig(root, { transformHref });

    const anchors = Array.from(root.querySelectorAll('a'));

    expect(anchors).toHaveLength(2);
    expect(anchors[0].getAttribute('href')).toBe('https://a.test/#x');
    expect(anchors[1].getAttribute('href')).toBe('https://b.test/#x');
    expect(anchors.every((a) => a.getAttribute('target') === '_blank')).toBe(true);
  });

  it('forces target="_self" on anchor-only links even when config sets _blank', () => {
    const root = makeRoot('<a href="#results">jump</a>');

    applyLinkConfig(root, { target: '_blank' });

    expect(root.querySelector('a')?.getAttribute('target')).toBe('_self');
  });

  it('forces target="_self" on same-page links even when config sets _blank', () => {
    const samePage = `${window.location.origin}${window.location.pathname}#section`;
    const root = makeRoot(`<a href="${samePage}">section</a>`);

    applyLinkConfig(root, { target: '_blank' });

    expect(root.querySelector('a')?.getAttribute('target')).toBe('_self');
  });

  it('keeps the configured target for cross-page links', () => {
    const root = makeRoot('<a href="https://google.com/">out</a>');

    applyLinkConfig(root, { target: '_blank' });

    expect(root.querySelector('a')?.getAttribute('target')).toBe('_blank');
  });

  it('decides same-page from the original href, not the transformHref result', () => {
    const root = makeRoot('<a href="#results">jump</a>');
    const transformHref = vi.fn((href: string) => `https://proxy.example/?u=${encodeURIComponent(href)}`);

    applyLinkConfig(root, { target: '_blank', transformHref });

    // The anchor still points at the current page conceptually, so it stays same-window.
    expect(root.querySelector('a')?.getAttribute('target')).toBe('_self');
  });

  it('is a no-op when there are no anchors', () => {
    const root = makeRoot('<p>plain paragraph</p>');

    expect(() => applyLinkConfig(root, { target: '_self' })).not.toThrow();
  });

  describe('transform (richer per-anchor config)', () => {
    it('passes the href, text and element to the transform', () => {
      const root = makeRoot('<a href="https://kb.internal/page">the label</a>');
      const transform = vi.fn(() => ({}));

      applyLinkConfig(root, { transform });

      const anchor = root.querySelector('a');

      expect(transform).toHaveBeenCalledTimes(1);
      expect(transform).toHaveBeenCalledWith({
        href: 'https://kb.internal/page',
        text: 'the label',
        element: anchor,
      });
    });

    it('applies the returned href, target, rel and extra attributes', () => {
      const root = makeRoot('<a href="https://kb.internal/page">link</a>');

      applyLinkConfig(root, {
        transform: () => ({
          href: 'https://public.example/page',
          target: '_self',
          rel: 'noopener',
          attributes: { class: 'kb-link', 'data-internal': 'true', title: 'Open' },
        }),
      });

      const anchor = root.querySelector('a');

      expect(anchor?.getAttribute('href')).toBe('https://public.example/page');
      expect(anchor?.getAttribute('target')).toBe('_self');
      expect(anchor?.getAttribute('rel')).toBe('noopener');
      expect(anchor?.getAttribute('class')).toBe('kb-link');
      expect(anchor?.getAttribute('data-internal')).toBe('true');
      expect(anchor?.getAttribute('title')).toBe('Open');
    });

    it('falls back to defaults for fields the transform leaves undefined', () => {
      const root = makeRoot('<a href="https://cross.example/page">link</a>');

      applyLinkConfig(root, {
        target: '_top',
        rel: 'noreferrer',
        transform: () => ({ attributes: { 'data-x': '1' } }),
      });

      const anchor = root.querySelector('a');

      // href unchanged, target/rel from the shorthand config, attribute added.
      expect(anchor?.getAttribute('href')).toBe('https://cross.example/page');
      expect(anchor?.getAttribute('target')).toBe('_top');
      expect(anchor?.getAttribute('rel')).toBe('noreferrer');
      expect(anchor?.getAttribute('data-x')).toBe('1');
    });

    it('treats a void/absent return as "keep every default"', () => {
      const root = makeRoot('<a href="https://cross.example/page">link</a>');

      applyLinkConfig(root, { transform: () => undefined });

      const anchor = root.querySelector('a');

      expect(anchor?.getAttribute('href')).toBe('https://cross.example/page');
      expect(anchor?.getAttribute('target')).toBe('_blank');
      expect(anchor?.getAttribute('rel')).toBe('nofollow');
    });

    it('supersedes transformHref when both are provided', () => {
      const root = makeRoot('<a href="https://kb.internal/page">link</a>');
      const transformHref = vi.fn((href: string) => `${href}?viaShorthand`);

      applyLinkConfig(root, {
        transformHref,
        transform: () => ({ href: 'https://via-transform.example/' }),
      });

      const anchor = root.querySelector('a');

      expect(transformHref).not.toHaveBeenCalled();
      expect(anchor?.getAttribute('href')).toBe('https://via-transform.example/');
    });

    it('keeps the same-page _self default (decided from the original href) when target is omitted', () => {
      const root = makeRoot('<a href="#results">jump</a>');

      applyLinkConfig(root, {
        target: '_blank',
        transform: ({ href }) => ({ href: `https://proxy.example/?u=${encodeURIComponent(href)}` }),
      });

      const anchor = root.querySelector('a');

      expect(anchor?.getAttribute('target')).toBe('_self');
      expect(anchor?.getAttribute('href')).toBe('https://proxy.example/?u=%23results');
    });

    it('lets the transform override the same-page target explicitly', () => {
      const root = makeRoot('<a href="#results">jump</a>');

      applyLinkConfig(root, { transform: () => ({ target: '_blank' }) });

      expect(root.querySelector('a')?.getAttribute('target')).toBe('_blank');
    });

    it('does not let attributes clobber the managed href/target/rel', () => {
      const root = makeRoot('<a href="https://kb.internal/page">link</a>');

      applyLinkConfig(root, {
        transform: () => ({
          href: 'https://managed.example/',
          target: '_self',
          rel: 'noopener',
          attributes: { href: 'https://evil.example/', target: '_blank', rel: 'x' },
        }),
      });

      const anchor = root.querySelector('a');

      expect(anchor?.getAttribute('href')).toBe('https://managed.example/');
      expect(anchor?.getAttribute('target')).toBe('_self');
      expect(anchor?.getAttribute('rel')).toBe('noopener');
    });
  });
});
